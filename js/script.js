// api and websocket endpoints
const API_URL = 'https://7cgcgrivhhqbo3mnbcvv3tftwm0deicc.lambda-url.eu-north-1.on.aws/';
const WS_URL = 'wss://6hir0irra5.execute-api.eu-north-1.amazonaws.com/production/';

// global state
let isLoggedIn = false;
let currentUserRole = null; 
let currentUserName = "User";
let currentUserCredits = 0;
let activeRequestId = null; // tracks current job
let currentVolunteerEmail = "";
let selectedRating = 5;
let userCoords = null; 
let currentUserRatingSum = 0;
let currentUserRatingCount = 0;

// maps and tracking state
let map = null;
let directionsService = null;
let directionsRenderer = null;
let ws = null;
let liveTrackingId = null;
let globalActiveMap = null;
let otherPersonMarker = null;
let activePassengerCoords = null;
let activeDestination = "";
let activeRouteIndex = 0;
let liveTrackingMap = null;
let passengerMarker = null;
let volunteerMarker = null;
let distanceMatrixService = null; // for eta

// override default alerts with bootstrap modals
window.alert = function(message) {
    document.getElementById('customModalTitle').innerText = "LiveHelper";
    document.getElementById('customModalBody').innerText = message;
    
    const footer = document.getElementById('customModalFooter');
    footer.innerHTML = `<button type="button" class="btn btn-primary px-4 rounded-pill" data-bs-dismiss="modal">OK</button>`;
    
    const modalEl = document.getElementById('customModal');
    const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    modal.show();
};

// custom confirm modal
function customConfirm(message, title = "Please Confirm") {
    return new Promise((resolve) => {
        document.getElementById('customModalTitle').innerText = title;
        document.getElementById('customModalBody').innerText = message;
        
        const footer = document.getElementById('customModalFooter');
        footer.innerHTML = `
            <button type="button" class="btn btn-light border px-3 rounded-pill" data-bs-dismiss="modal" id="btnConfirmCancel">Cancel</button>
            <button type="button" class="btn btn-primary px-4 rounded-pill" data-bs-dismiss="modal" id="btnConfirmOk">I Agree</button>
        `;
        
        const modalEl = document.getElementById('customModal');
        const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
        
        document.getElementById('btnConfirmOk').onclick = () => resolve(true);
        document.getElementById('btnConfirmCancel').onclick = () => resolve(false);
        
        // treat clicking outside as cancel
        modalEl.addEventListener('hidden.bs.modal', function handler() {
            resolve(false);
            modalEl.removeEventListener('hidden.bs.modal', handler);
        }, { once: true });

        modal.show();
    });
}


// --- websockets & live tracking ---

function connectLiveTracking() {
    if (ws) return; // prevent double connections
    
    ws = new WebSocket(WS_URL);
    ws.onopen = () => console.log("live tracking connected");
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        // incoming gps update from the other user
        if (data.type === 'live_gps' && data.role !== currentUserRole) {
            
            // hide connecting screen if volunteer accepted
            if (currentUserRole === 'passenger' && data.role === 'volunteer') {
                const overlay = document.getElementById('connecting-overlay');
                if (overlay && overlay.style.display === 'block') {
                    overlay.style.display = 'none'; 
                    alert("A volunteer has accepted your request and is on their way!");
                }
            }
            
            // update map position
            if (globalActiveMap) {
                const newPos = { lat: data.lat, lng: data.lng };
                
                if (!otherPersonMarker) {
                    otherPersonMarker = new google.maps.Marker({
                        position: newPos,
                        map: globalActiveMap,
                        title: data.role === 'volunteer' ? 'Volunteer' : 'Passenger',
                        icon: data.role === 'volunteer' ? 'http://maps.google.com/mapfiles/ms/icons/green-dot.png' : 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png'
                    });
                } else {
                    otherPersonMarker.setPosition(newPos);
                }
            }
        
        // passenger getting volunteer offers
        } else if (data.type === 'volunteer_offer' && currentUserRole === 'passenger') {
            const list = document.getElementById('volunteer-offers-list');
            if (list.innerHTML.includes('spinner-border')) list.innerHTML = '';
            
            // parse the data we packed into the email field
            const extra = JSON.parse(data.email);
            
            // escape apostrophes for places like King's Cross
            const safeDest = extra.dest.replace(/'/g, "\\'");
            const safeEmbark = extra.embark.replace(/'/g, "\\'");
            
            list.innerHTML += `
                <div class="card border-success shadow-sm mb-2">
                    <div class="card-body p-2 d-flex justify-content-between align-items-center">
                        <div>
                           <strong class="text-success">${extra.vName}</strong><br>
                            <small class="text-muted">⭐ ${extra.vRating}</small>
                        </div>
                        <button class="btn btn-sm btn-success" onclick="acceptOffer('${extra.vEmail}', '${extra.reqId}', ${data.lat}, ${data.lng}, '${safeDest}', '${safeEmbark}')">Choose</button>
                    </div>
                </div>
            `;
            
        // passenger tracking the chosen volunteer
        } else if (data.type === 'update_location') {
            
            if (currentUserRole === 'passenger' && currentVolunteerEmail && liveTrackingMap) {
                const volExtra = JSON.parse(data.email);

                // make sure it's the right volunteer
                if (volExtra.vEmail === currentVolunteerEmail) {
                    const volPos = { lat: volExtra.vLat, lng: volExtra.vLng };
                    
                    if (volunteerMarker) {
                        volunteerMarker.setPosition(volPos);
                    } else {
                        volunteerMarker = new google.maps.Marker({
                            position: volPos,
                            map: liveTrackingMap,
                            title: 'Your Volunteer',
                            icon: {
                                url: 'https://maps.google.com/mapfiles/ms/icons/green-dot.png',
                                scaledSize: new google.maps.Size(40, 40)
                            }
                        });
                    }

                    // fit map bounds
                    if (passengerMarker) {
                        const bounds = new google.maps.LatLngBounds();
                        bounds.extend(passengerMarker.getPosition());
                        bounds.extend(volPos);
                        liveTrackingMap.fitBounds(bounds);
                    }

                    // calc eta
                    if (!distanceMatrixService) distanceMatrixService = new google.maps.DistanceMatrixService();
                    
                    if (userCoords) {
                        distanceMatrixService.getDistanceMatrix({
                            origins: [volPos],
                            destinations: [userCoords],
                            travelMode: 'DRIVING',
                        }, (response, status) => {
                            if (status === 'OK' && response.rows[0].elements[0].status === 'OK') {
                                const element = response.rows[0].elements[0];
                                document.getElementById('tracking-eta-text').innerText = element.duration.text;
                                document.getElementById('tracking-distance-text').innerText = element.distance.text + " away";
                            }
                        });
                    }
                }
            }

        // volunteer gets accepted
        } else if (data.type === 'offer_accepted' && currentUserRole === 'volunteer') {
            try {
                const extra = JSON.parse(data.email);
                const myEmail = document.getElementById('email').value || "Unknown";
                
                if (extra.vEmail === myEmail) {
                    alert("The passenger chose you! Starting navigation.");
                    acceptRequest(extra.reqId, data.lat || 0, data.lng || 0, extra.dest, extra.embark, true, extra.routeIndex);
                } else {
                    // lost the bid, refresh feed
                    loadVolunteerFeed();
                }
            } catch(err) {
                console.error("handshake error:", err);
            }
            
        // feed updates
        } else if (data.type === 'refresh_feeds' && currentUserRole === 'volunteer') {
            if (document.getElementById('screen-volunteer').classList.contains('active-screen')) {
                loadVolunteerFeed();
            }
               
        // passenger accepts offer handling
        } else if (data.type === 'offer_accepted' && currentUserRole === 'passenger') {
            const extra = JSON.parse(data.email);
            currentVolunteerEmail = extra.vEmail; 
            switchToTrackingView();
        
        // job done, show rating
        } else if (data.type === 'job_completed' && currentUserRole === 'passenger') {
            alert("You have reached your destination! Please rate your volunteer.");
            
            document.getElementById('map-container').style.display = 'none';
            document.getElementById('screen-passenger-tracking').style.display = 'none';
            document.getElementById('rating-overlay').style.display = 'block';
            window.scrollTo({ top: 0, behavior: 'smooth' });
            
            currentVolunteerEmail = data.volunteerEmail;
            
            if (liveTrackingId) navigator.geolocation.clearWatch(liveTrackingId);
            
        // update volunteer stats live
        } else if (data.type === 'rating_updated' && currentUserRole === 'volunteer') {
            const myEmail = document.getElementById('email').value || "Unknown";
            
            if (data.email === myEmail) {
                currentUserRatingSum += data.lat; // rating is stored in lat
                currentUserRatingCount += 1;
                
                if (document.getElementById('screen-profile').classList.contains('active-screen')) {
                    loadProfile(); 
                }
            }
            
        // handle mid-trip cancellations
        } else if (data.type === 'job_cancelled_mid_trip' && currentUserRole === 'volunteer') {
            const myEmail = document.getElementById('email').value || "Unknown";
            
            if (data.email === myEmail) {
                alert("The passenger cancelled the journey. Returning to feed.");

                if (liveTrackingId) navigator.geolocation.clearWatch(liveTrackingId);
                if (otherPersonMarker) otherPersonMarker.setMap(null);
                otherPersonMarker = null;

                document.getElementById('volunteer-nav').style.display = 'none';
                document.getElementById('requests-feed').style.display = 'block';
                loadVolunteerFeed();
            }
        }
    };
}
    
// watch gps and send to server
function startBroadcastingGPS() {
    if (navigator.geolocation) {
        liveTrackingId = navigator.geolocation.watchPosition((pos) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                     action: 'sync_location',
                     type: 'live_gps',
                     role: currentUserRole,
                     email: document.getElementById('email').value || "Guest",
                     lat: pos.coords.latitude,
                     lng: pos.coords.longitude
                }));
            }
        }, (err) => console.log("gps err:", err), { enableHighAccuracy: true });
    }
}

// toggle button visibility based on role
function updateUIVisibility() {
    const homePassenger = document.getElementById('home-card-passenger');
    const homeVolunteer = document.getElementById('home-card-volunteer');
    const navPassenger = document.getElementById('nav-tab-passenger');
    const navVolunteer = document.getElementById('nav-tab-volunteer');

    if(homePassenger) { homePassenger.style.display = ''; homePassenger.className = "col-6"; }
    if(homeVolunteer) { homeVolunteer.style.display = ''; homeVolunteer.className = "col-6"; }
    if(navPassenger) navPassenger.style.display = '';
    if(navVolunteer) navVolunteer.style.display = '';

    if (isLoggedIn) {
        if (currentUserRole === 'passenger') {
            if(homeVolunteer) homeVolunteer.style.display = 'none';
            if(navVolunteer) navVolunteer.style.display = 'none';
            if(homePassenger) homePassenger.className = "col-12";
        } else if (currentUserRole === 'volunteer') {
            if(homePassenger) homePassenger.style.display = 'none';
            if(navPassenger) navPassenger.style.display = 'none';
            if(homeVolunteer) homeVolunteer.className = "col-12";
        }
    }
}


// --- navigation & auth ---

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active-screen'));
    const target = document.getElementById(screenId);
    if(target) target.classList.add('active-screen');

    // sync bottom nav highlight
    const bottomNavs = document.querySelectorAll('.bottom-nav .nav-link');
    if (bottomNavs.length > 0) {
        bottomNavs.forEach(nav => nav.classList.remove('active'));
        
        if (screenId === 'screen-home') bottomNavs[0].classList.add('active');
        else if (screenId === 'screen-passenger') bottomNavs[1].classList.add('active');
        else if (screenId === 'screen-volunteer') bottomNavs[2].classList.add('active');
        else if (screenId === 'screen-profile' || screenId === 'screen-settings') bottomNavs[3].classList.add('active');
    }
}

function handleActionClick(role) {
    if (!isLoggedIn) {
        goToLogin();
        switchLoginTab(role);
    } else {
        if (role === 'passenger') {
            showScreen('screen-passenger');
        } else {
            showScreen('screen-volunteer');
            loadVolunteerFeed();
        }
    }
}

function checkLogin(role) { handleActionClick(role); }
function goToLogin() { showScreen('screen-login'); }

function logout() {
    isLoggedIn = false;
    currentUserRole = null; 
    
    if (ws) ws.close();
    if (liveTrackingId) navigator.geolocation.clearWatch(liveTrackingId);
    ws = null;
    otherPersonMarker = null;

    const btn = document.getElementById('authBtn');
    if(btn) {
        btn.innerHTML = 'Log In <i class="fa-solid fa-arrow-right-to-bracket"></i>';
        btn.setAttribute('onclick', 'goToLogin()');
    }
    showScreen('screen-home');
    alert("Logged out.");
    
    updateUIVisibility();
}

function switchLoginTab(role) {
    const roleInput = document.getElementById('userRole');
    if(roleInput) roleInput.value = role;
    
    document.querySelectorAll('.nav-link').forEach(t => t.classList.remove('active'));
    if(role === 'passenger') document.getElementById('tab-passenger').classList.add('active');
    else document.getElementById('tab-volunteer').classList.add('active');
}

function toggleAuthMode() {
    const modeInput = document.getElementById('authMode');
    const title = document.getElementById('auth-title');
    const btn = document.getElementById('submitBtn');
    const toggleText = document.getElementById('toggleText');
    const signupFields = document.getElementById('signup-fields');

    if (modeInput.value === 'login') {
        modeInput.value = 'signup';
        title.innerText = "Create Account";
        btn.innerText = "Sign Up";
        toggleText.innerHTML = 'Already have an account? <a href="#" onclick="toggleAuthMode()">Log In</a>';
        signupFields.style.display = 'block';
    } else {
        modeInput.value = 'login';
        title.innerText = "Sign In";
        btn.innerText = "Log In";
        toggleText.innerHTML = 'New here? <a href="#" onclick="toggleAuthMode()">Create Account</a>';
        signupFields.style.display = 'none';
    }
}

const authForm = document.getElementById('authForm');
if(authForm) {
    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const btn = document.getElementById('submitBtn');
        const originalText = btn.innerHTML;
        btn.innerHTML = 'Connecting...';
        btn.disabled = true;

        // form validation
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const role = document.getElementById('userRole').value; 
        const mode = document.getElementById('authMode').value; 
        const name = document.getElementById('fullName').value.trim();
        const phone = document.getElementById('phone').value.trim();
        
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const passwordRegex = /^.{6,}$/;
        const nameRegex = /^[a-zA-Z\s]{2,50}$/;
        const phoneRegex = /^\+?[0-9]{10,15}$/;

        if (!emailRegex.test(email)) {
            alert("Please enter a valid email.");
            btn.innerHTML = originalText;
            btn.disabled = false;
            return;
        }
        if (!passwordRegex.test(password)) {
            alert("Password must be at least 6 characters.");
            btn.innerHTML = originalText;
            btn.disabled = false;
            return;
        }

        if (mode === 'signup') {
            if (!nameRegex.test(name)) {
                alert("Please enter a valid name.");
                btn.innerHTML = originalText;
                btn.disabled = false;
                return;
            }
            if (!phoneRegex.test(phone)) {
                alert("Please enter a valid phone number.");
                btn.innerHTML = originalText;
                btn.disabled = false;
                return;
            }
        }

        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    action: mode,
                    email, password, role,
                    name: mode === 'signup' ? name : undefined,
                    phone: mode === 'signup' ? phone : undefined
                })
            });
            const data = await response.json();

            if (data.success) {
                // prevent role mismatch on login
                if (mode === 'login' && data.role && data.role !== role) {
                    alert("Account registered as " + data.role + ". Switch tabs to log in.");
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                    return;
                }

                isLoggedIn = true;
                currentUserRole = data.role || role;
                
                const safeName = name.trim() !== '' ? name : "New User";
                currentUserName = mode === 'signup' ? safeName : (data.name || "New User");
                currentUserCredits = data.credits || 0;
                currentUserRatingSum = data.ratingSum || 0; 
                currentUserRatingCount = data.ratingCount || 0; 
                
                updateUIVisibility(); 
                connectLiveTracking();
                
                const loginBtn = document.getElementById('authBtn');
                if(loginBtn) {
                    loginBtn.innerHTML = 'Log Out';
                    loginBtn.setAttribute('onclick', 'logout()');
                }
                
                if (currentUserRole === 'passenger') showScreen('screen-passenger');
                else { showScreen('screen-volunteer'); loadVolunteerFeed(); }
            } else {
                alert("Error: " + (data.error || "Unknown error"));
            }
        } catch (error) {
            console.error(error);
            alert("Connection Error.");
        } finally {
            if (btn) {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }
    });
}

// --- passenger logic ---

function getGPS() {
    const display = document.getElementById('locationDisplay');
    display.value = "Locating...";
    
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                userCoords = { lat: lat, lng: lng };
                
                const geocoder = new google.maps.Geocoder();
                geocoder.geocode({ location: { lat: lat, lng: lng } }, (results, status) => {
                    if (status === "OK" && results[0]) {
                        display.value = results[0].formatted_address; 
                    } else {
                        display.value = `📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}`; 
                    }
                });
            },
            (error) => { 
                console.log("gps error:", error);
                display.value = ""; 
                alert("Could not locate automatically. Please type it in.");
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    } else {
        alert("Location not supported.");
    }
}

const reqForm = document.getElementById('requestForm');
if(reqForm) {
    reqForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const embarkVal = document.getElementById('locationDisplay').value.trim();
        const dest = document.getElementById('destination').value;

        if (!embarkVal) {
            alert("Please enter a starting location.");
            return;
        }

        const processRequest = () => {
            document.getElementById('requestForm').style.display = 'none';
            document.getElementById('map-container').style.display = 'block';
            initGoogleMap(userCoords.lat, userCoords.lng, dest);
        };

        // handle manually typed addresses
        if (!userCoords) {
            const geocoder = new google.maps.Geocoder();
            geocoder.geocode({ address: embarkVal + ", London, UK", bounds: new google.maps.LatLngBounds(
                new google.maps.LatLng(51.286760, -0.510375), new google.maps.LatLng(51.691874, 0.334015)
            )}, (results, status) => {
                if (status === "OK" && results[0]) {
                    userCoords = { lat: results[0].geometry.location.lat(), lng: results[0].geometry.location.lng() };
                    document.getElementById('locationDisplay').value = results[0].formatted_address;
                    processRequest();
                } else {
                    alert("Could not find location. Try the dropdown or GPS.");
                }
            });
        } else {
            processRequest();
        }
    });
}

async function confirmSelection() {
    const overlay = document.getElementById('connecting-overlay');
    const offersList = document.getElementById('volunteer-offers-list');
    
    if (offersList) {
        offersList.innerHTML = '<div class="text-center text-muted small spinner-border mx-auto" role="status"></div>';
    }

    if(overlay) {
        overlay.style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    const embarkation = document.getElementById('locationDisplay').value || "Current Location";
    const dest = document.getElementById('destination').value || "Anywhere";
    const timeWindow = document.getElementById('timeWindow') ? document.getElementById('timeWindow').value : "ASAP";
    const hType = document.getElementById('helpType') ? document.getElementById('helpType').value : "General";

    const finalLat = userCoords ? userCoords.lat : 51.5074; 
    const finalLng = userCoords ? userCoords.lng : -0.1278;

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({
                action: 'request_help', 
                email: document.getElementById('email').value || "Guest",
                name: currentUserName, 
                embarkation: embarkation, 
                destination: dest,        
                timeWindow: timeWindow,   
                helpType: hType,
                lat: finalLat,
                lng: finalLng
            })
        });
        
        const data = await response.json(); 

        if (data.success) {
            activeRequestId = document.getElementById('email').value; 
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ action: 'sync_location', type: 'refresh_feeds', role: 'passenger', email: 'system', lat: 0, lng: 0 }));
            }
            startBroadcastingGPS();
        } else {
            alert("Server Error: " + data.error);
            if (overlay) overlay.style.display = 'none';
        }
    } catch(err) {
        console.error("save error:", err);
        if (overlay) overlay.style.display = 'none';
    }
}

async function cancelRequest() {
    document.getElementById('connecting-overlay').style.display = 'none';
    document.getElementById('map-container').style.display = 'none';
    document.getElementById('screen-passenger-tracking').style.display = 'none'; 
    document.getElementById('requestForm').style.display = 'block';
    
    if (liveTrackingId) navigator.geolocation.clearWatch(liveTrackingId);
    
    if (activeRequestId) {
        try {
            await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    action: 'cancel_request', 
                    email: activeRequestId
                })
            });
            
            activeRequestId = null;
            
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ action: 'sync_location', type: 'refresh_feeds', role: 'passenger', email: 'system', lat: 0, lng: 0 }));
                
                if (currentVolunteerEmail) {
                    ws.send(JSON.stringify({ action: 'sync_location', type: 'job_cancelled_mid_trip', role: 'passenger', email: currentVolunteerEmail, lat: 0, lng: 0 }));
                }
            }
        } catch (err) { 
            console.error("cancel error:", err); 
        }
    }
    
    currentVolunteerEmail = ""; 
    alert("Request cancelled.");
}


// --- volunteer logic ---

async function loadVolunteerFeed() {
    const feed = document.getElementById('requests-feed');
    if(!feed) return;
    
    feed.innerHTML = `<div class="text-center py-4"><div class="spinner-border text-success"></div><p>Loading...</p></div>`;

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'get_volunteer_feed' }) 
        });
        const data = await res.json();

        let validRequests = [];
        if (data.success && data.requests) {
            // filter out bad entries
            validRequests = data.requests.filter(req => {
                const embark = req.embarkation || req.startLocation || "";
                const dest = req.destination || "";
                
                return req.lat !== undefined && 
                       req.lng !== undefined && 
                       embark.trim() !== "" && 
                       embark !== "Unknown Location" && 
                       dest.trim() !== "";
            });
        }

        if (validRequests.length > 0) {
            feed.innerHTML = validRequests.map(req => {
                const safeDest = req.destination.replace(/'/g, "\\'");
                const safeEmbark = (req.embarkation || req.startLocation).replace(/'/g, "\\'");
                const safeTime = req.timeWindow || 'ASAP';
                const safeType = req.helpType || 'General Help';

                return `
                <div class="card mb-3 border-0 shadow-sm">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <h5 class="card-title fw-bold text-dark mb-0">${req.passengerName || "Passenger"}</h5>
                            <span class="badge bg-danger">${safeTime}</span>
                        </div>
                        
                        <p class="card-text text-muted small mb-1"><strong>Embarkation:</strong> ${safeEmbark}</p>
                        <p class="card-text text-muted small mb-2"><strong>Exit Stop:</strong> ${safeDest}</p>
                        <span class="badge bg-primary mb-3">${safeType}</span>
                        
                        <div class="d-grid">
                            <button class="btn btn-success fw-bold" 
                                onclick="sendOffer('${req.passengerEmail}', ${req.lat || 0}, ${req.lng || 0}, '${safeDest}', '${safeEmbark}')">
                               Offer to Help
                            </button>
                        </div>
                    </div>
                </div>
                `;
            }).join('');
        } else {
            feed.innerHTML = `<p class="text-center text-muted">No active requests found.</p>`;
        }
    } catch (err) {
        feed.innerHTML = `<p class="text-center text-danger">Could not connect to server.</p>`;
    }
}

async function acceptRequest(requestId, passengerLat, passengerLng, destName, embarkName, skipConfirm = false, passengerRouteIndex = 0) {
    activeRequestId = requestId; 
    activeRouteIndex = passengerRouteIndex;

    if (!skipConfirm) {
        const agreementMessage = `Do you agree to help the passenger from ${embarkName} to ${destName}?`;
        const isConfirmed = await customConfirm(agreementMessage); 
        if (!isConfirmed) return; 
    }
    
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ 
                action: 'accept_request',
                passengerEmail: requestId, 
                volunteerEmail: document.getElementById('email').value || "Unknown",
                volunteerName: currentUserName
             }) 
        });
        const data = await res.json();

        if (!data.success) {
            alert("This request was taken by someone else or cancelled.");
            loadVolunteerFeed(); 
            return;
        }

        startLiveGpsBroadcasting();

    } catch (error) { 
        alert("Server error.");
        return;
    }

    document.getElementById('requests-feed').style.display = 'none';
    document.getElementById('volunteer-nav').style.display = 'block';
    
    document.getElementById('btn-nearby').style.display = 'block';
    document.getElementById('btn-complete').style.display = 'none';
    document.getElementById('vol-nav-title').innerHTML = '<i class="fa-solid fa-person-walking-arrow-right"></i> Heading to Passenger';
    
    const statusText = document.getElementById('nav-dest');
    if(statusText) statusText.innerText = "Meeting at: " + embarkName;

    activePassengerCoords = { lat: passengerLat, lng: passengerLng };
    activeDestination = destName;

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((position) => {
            const volLat = position.coords.latitude;
            const volLng = position.coords.longitude;

            const mapDiv = document.getElementById('volunteer-map');
            const volMap = new google.maps.Map(mapDiv, {
                zoom: 14,
                center: { lat: volLat, lng: volLng },
                disableDefaultUI: true 
            });
            
            globalActiveMap = volMap;

            const dirService = new google.maps.DirectionsService();
            window.volDirRenderer = new google.maps.DirectionsRenderer({ 
                map: volMap,
                panel: document.getElementById('vol-directions-panel')
            });

            dirService.route({
                origin: { lat: volLat, lng: volLng },
                destination: { lat: passengerLat, lng: passengerLng },
                travelMode: 'TRANSIT',
                transitOptions: { modes: ['SUBWAY', 'TRAIN', 'BUS'] }
            }, (result, status) => {
                if (status === 'OK') {
                    window.volDirRenderer.setDirections(result);
                } else {
                    dirService.route({
                        origin: { lat: volLat, lng: volLng },
                        destination: { lat: passengerLat, lng: passengerLng },
                        travelMode: 'WALKING'
                    }, (res, stat) => {
                        if (stat === 'OK') window.volDirRenderer.setDirections(res);
                    });
                }
            });
            
        }, () => alert("GPS Error."));
    } else {
        alert("Geolocation not supported.");
    }
}


// --- google maps ---

function initGoogleMap(userLat, userLng, destinationText) {
    const mapContainer = document.getElementById('google-map');
    const panelContainer = document.getElementById('directions-panel'); 

    if (!map) {
        map = new google.maps.Map(mapContainer, {
            zoom: 14,
            center: { lat: userLat, lng: userLng },
            mapTypeControl: false, 
            fullscreenControl: false,
            streetViewControl: false
        });
        directionsService = new google.maps.DirectionsService();
        directionsRenderer = new google.maps.DirectionsRenderer();
        
        directionsRenderer.setMap(map);
        directionsRenderer.setPanel(panelContainer); 
    }
    
    globalActiveMap = map;

    directionsService.route({
        origin: { lat: userLat, lng: userLng },
        destination: destinationText, 
        travelMode: 'TRANSIT', 
        provideRouteAlternatives: true, 
        transitOptions: { modes: ['SUBWAY', 'TRAIN', 'BUS'], routingPreference: 'FEWER_TRANSFERS' }
    }, function(result, status) {
        if (status == 'OK') {
            directionsRenderer.setDirections(result);
        } else {
            if (status === 'ZERO_RESULTS') {
                alert('No transit route found, falling back to walking.');
                directionsService.route({
                    origin: { lat: userLat, lng: userLng },
                    destination: destinationText, 
                    travelMode: 'WALKING'
                }, (res, stat) => {
                    if (stat === 'OK') directionsRenderer.setDirections(res);
                });
            } else {
                alert('Route error: ' + status);
            }
        }
    });
}

window.onload = function() {
    const destInput = document.getElementById('destination');
    const startInput = document.getElementById('locationDisplay');
    
    if (google) {
        const londonBounds = new google.maps.LatLngBounds(
            new google.maps.LatLng(51.286760, -0.510375),
            new google.maps.LatLng(51.691874, 0.334015)
        );

        const autocompleteOptions = {
            bounds: londonBounds,
            strictBounds: true, 
            fields: ["formatted_address", "geometry", "name"],
            componentRestrictions: { country: "GB" } 
        };

        if (destInput) new google.maps.places.Autocomplete(destInput, autocompleteOptions);

        if (startInput) {
            const startAutocomplete = new google.maps.places.Autocomplete(startInput, autocompleteOptions);
            startAutocomplete.addListener('place_changed', () => {
                const place = startAutocomplete.getPlace();
                if (place.geometry) {
                    userCoords = { lat: place.geometry.location.lat(), lng: place.geometry.location.lng() };
                }
            });
        }
    }
};

async function completeJob() {
    try {
        const email = document.getElementById('email').value || "Guest";
        
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                action: 'sync_location', 
                type: 'job_completed',
                role: currentUserRole,
                volunteerEmail: email
            }));
        }

        await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                action: 'complete_job',
                passengerEmail: activeRequestId,
                volunteerEmail: email
             }) 
        });
        
        currentUserCredits += 10;
        alert("Job done! +10 credits.");
        
    } catch(err) {
        console.error("credit error:", err);
    }

    if (liveTrackingId) navigator.geolocation.clearWatch(liveTrackingId);
    if (otherPersonMarker) otherPersonMarker.setMap(null);
    otherPersonMarker = null;

    document.getElementById('volunteer-nav').style.display = 'none';
    document.getElementById('requests-feed').style.display = 'block';
    loadVolunteerFeed();
}

// --- profile & settings ---

function loadProfile() {
    if (!isLoggedIn) {
        alert("Please log in.");
        goToLogin();
        return;
    }

    document.getElementById('profile-name').innerText = currentUserName;
    document.getElementById('profile-role').innerText = currentUserRole.toUpperCase();
    
    const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUserName)}&background=eff6ff&color=2563eb&size=100&rounded=true`;
    document.getElementById('profile-avatar').src = avatarUrl;
    
    if (currentUserRole === 'volunteer') {
        document.getElementById('volunteer-stats').style.display = 'block';
        document.getElementById('profile-credits').innerText = currentUserCredits;
        
        let avgRating = "New"; 
        if (currentUserRatingCount > 0) {
            avgRating = (currentUserRatingSum / currentUserRatingCount).toFixed(1);
        }
        document.getElementById('profile-rating').innerText = avgRating;
    } else {
        document.getElementById('volunteer-stats').style.display = 'none';
    }

    showScreen('screen-profile');

    document.querySelectorAll('.nav-link').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.bottom-nav .nav-link')[3].classList.add('active');
}

function openSettings() {
    document.getElementById('settingsEmail').value = document.getElementById('email').value || "";
    document.getElementById('settingsName').value = currentUserName || "";
    document.getElementById('settingsPassword').value = ""; 
    
    showScreen('screen-settings');
}

async function saveSettings(e) {
    e.preventDefault();
    const btn = document.getElementById('settingsSaveBtn');
    btn.innerHTML = 'Saving...';
    btn.disabled = true;

    const newName = document.getElementById('settingsName').value.trim();
    const newPhone = document.getElementById('settingsPhone').value.trim();
    const newPassword = document.getElementById('settingsPassword').value;

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'update_profile',
                email: document.getElementById('settingsEmail').value,
                name: newName,
                phone: newPhone,
                password: newPassword
            })
        });
        const data = await response.json();
        
        if (data.success) {
            currentUserName = newName;
            alert("Profile updated.");
            loadProfile();
        } else {
            alert("Error: " + data.error);
        }
    } catch (err) {
        alert("Connection error.");
    } finally {
        btn.innerHTML = 'Save Changes';
        btn.disabled = false;
    }
}

// --- rating & job flow ---

function setRating(stars) {
    selectedRating = stars;
    const starElements = document.querySelectorAll('#star-container i');
    
    starElements.forEach((star, index) => {
        if (index < stars) {
            star.classList.remove('text-muted');
            star.classList.add('text-warning');
        } else {
            star.classList.remove('text-warning');
            star.classList.add('text-muted');
        }
    });
}

async function submitRating() {
    try {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                action: 'sync_location',
                type: 'rating_updated',
                role: 'passenger',
                email: currentVolunteerEmail,
                lat: selectedRating, // pass rating in lat to save payload size
                lng: 0
            }));
        }

        await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'submit_rating',
                volunteerEmail: currentVolunteerEmail,
                rating: selectedRating
            })
        });
    } catch(err) {
        console.error("rating error:", err);
    }
    
    document.getElementById('rating-overlay').style.display = 'none';
    document.getElementById('screen-passenger-tracking').style.display = 'none'; 
    document.getElementById('requestForm').style.display = 'block'; 
    
    showScreen('screen-home');
}

function acceptOffer(volEmail, reqId, lat, lng, dest, embark) {
    document.getElementById('connecting-overlay').style.display = 'none';
    
    // pack data into email field since aws only forwards specific fields
    const packedData = JSON.stringify({
        vEmail: volEmail,
        reqId: reqId,
        dest: dest,
        embark: embark,
        routeIndex: directionsRenderer ? directionsRenderer.getRouteIndex() : 0 
    });

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            action: 'sync_location',
            type: 'offer_accepted',
            role: 'passenger',
            email: packedData, 
            lat: Number(lat) || 0, 
            lng: Number(lng) || 0
        }));
    }

    currentVolunteerEmail = volEmail;
    switchToTrackingView();
}

function sendOffer(requestId, passengerLat, passengerLng, destName, embarkName) {
    alert("Offer sent.");
    
    let rating = "New";
    if (currentUserRatingCount > 0) {
        rating = (currentUserRatingSum / currentUserRatingCount).toFixed(1);
    }

    const packedData = JSON.stringify({
        vEmail: document.getElementById('email').value || "Unknown",
        vName: currentUserName,
        vRating: rating,
        reqId: requestId,
        dest: destName,
        embark: embarkName
    });

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            action: 'sync_location', 
            type: 'volunteer_offer',
            role: 'volunteer',
            email: packedData,
            lat: passengerLat, 
            lng: passengerLng
        }));
    }
}

function imNearby() {
    document.getElementById('btn-nearby').style.display = 'none';
    document.getElementById('btn-complete').style.display = 'block';
    
    document.getElementById('vol-nav-title').innerHTML = '<i class="fa-solid fa-route"></i> Navigating to Destination';
    document.getElementById('nav-dest').innerText = "Heading to: " + activeDestination;

    const dirService = new google.maps.DirectionsService();
    
    dirService.route({
        origin: activePassengerCoords, 
        destination: activeDestination, 
        travelMode: 'TRANSIT',
        provideRouteAlternatives: true,
        transitOptions: { modes: ['SUBWAY', 'TRAIN', 'BUS'], routingPreference: 'FEWER_TRANSFERS' }
    }, (result, status) => {
        if (status === 'OK') {
            window.volDirRenderer.setDirections(result);
            window.volDirRenderer.setRouteIndex(activeRouteIndex || 0); // match passenger route
        } else {
            dirService.route({
                origin: activePassengerCoords,
                destination: activeDestination,
                travelMode: 'WALKING'
            }, (res, stat) => {
                if (stat === 'OK') window.volDirRenderer.setDirections(res);
            });
        }
    });
}

function startLiveGpsBroadcasting() {
    if (navigator.geolocation) {
        liveTrackingId = navigator.geolocation.watchPosition((position) => {
            if (!ws || ws.readyState !== WebSocket.OPEN) return; 

            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            
            const packedData = JSON.stringify({
                vEmail: document.getElementById('email').value || "Unknown",
                vLat: lat,
                vLng: lng
            });

            ws.send(JSON.stringify({
                action: 'sync_location', 
                type: 'update_location', 
                role: 'volunteer',
                email: packedData 
            }));
        }, () => console.error("geo access denied"), { enableHighAccuracy: true });
    }
}

function switchToTrackingView() {
    document.getElementById('map-container').style.display = 'none';
    document.getElementById('connecting-overlay').style.display = 'none';
    document.getElementById('screen-passenger-tracking').style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });

    const mapDiv = document.getElementById('live-tracking-map');
    const mapPos = userCoords || { lat: 51.5, lng: -0.1 }; 
    
    liveTrackingMap = new google.maps.Map(mapDiv, {
        zoom: 16,
        center: mapPos,
        disableDefaultUI: true 
    });

    if(userCoords) {
        passengerMarker = new google.maps.Marker({
            position: userCoords,
            map: liveTrackingMap,
            title: 'Your Location'
        });
    }
}