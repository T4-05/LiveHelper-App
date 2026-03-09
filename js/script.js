// ✅ REST API (For Login/Database)
const API_URL = 'https://zsc77qfohvxqopbuznvxnesa3a0cjudo.lambda-url.us-east-1.on.aws/';

// ✅ NEW: WEBSOCKET API (For Live GPS Tracking)
const WS_URL = 'wss://25j6a7ib12.execute-api.us-east-1.amazonaws.com/production/';

// GLOBAL STATE
let isLoggedIn = false;
let currentUserRole = null; 
let currentUserName = "User";   // Stores Name for Profile
let currentUserCredits = 0;     // Stores Credits for Profile
let activeRequestId = null;     // Remembers the job they are currently doing
let currentVolunteerEmail = ""; // Remembers who is helping the passenger
let selectedRating = 5;         // Default star rating
let userCoords = null; 
let currentUserRatingSum = 0;   // ✅ NEW: Total stars earned
let currentUserRatingCount = 0; // ✅ NEW: Total number of reviews

// Maps & Live Tracking State
let map = null;
let directionsService = null;
let directionsRenderer = null;
let ws = null;              // Holds the WebSocket connection
let liveTrackingId = null;  // Holds the GPS watcher
let globalActiveMap = null; // Tells the WebSocket which map to draw on
let otherPersonMarker = null; // The dot representing the other user
let activePassengerCoords = null;
let activeDestination = "";
let activeRouteIndex = 0; // Remembers which route alternative the passenger picked
let liveTrackingMap = null; // Stores the passenger's tracking map instance
let passengerMarker = null; // Saves the passenger's marker on the map
let volunteerMarker = null; // Saves the volunteer's moving marker
let distanceMatrixService = null; // Used to calculate the Uber ETA!






// ==========================================
// 1. WEBSOCKET & LIVE TRACKING
// ==========================================

function connectLiveTracking() {
    if (ws) return; // Don't connect twice
    
    ws = new WebSocket(WS_URL);
    
    ws.onopen = () => console.log("🟢 Live GPS Connected");
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        // --- SCENARIO A: We receive a GPS update from the OTHER person ---
        if (data.type === 'live_gps' && data.role !== currentUserRole) {
            
            // Push volunteer info to client (Hide "Connecting" screen)
            if (currentUserRole === 'passenger' && data.role === 'volunteer') {
                const overlay = document.getElementById('connecting-overlay');
                if (overlay && overlay.style.display === 'block') {
                    overlay.style.display = 'none'; 
                    alert("✅ A Volunteer has accepted your request and is on their way!");
                }
            }
            
            // Live update of position on the map
            if (globalActiveMap) {
                const newPos = { lat: data.lat, lng: data.lng };
                
                if (!otherPersonMarker) {
                    otherPersonMarker = new google.maps.Marker({
                        position: newPos,
                        map: globalActiveMap,
                        title: data.role === 'volunteer' ? 'Volunteer' : 'Passenger',
                        // Volunteer is green dot, passenger is blue dot
                        icon: data.role === 'volunteer' ? 'http://maps.google.com/mapfiles/ms/icons/green-dot.png' : 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png'
                    });
                } else {
                    otherPersonMarker.setPosition(newPos); // Move the dot smoothly
                }
            }
        

       // --- SCENARIO C: Passenger receives an offer from a Volunteer ---
        } else if (data.type === 'volunteer_offer' && currentUserRole === 'passenger') {
            const list = document.getElementById('volunteer-offers-list');
            if (list.innerHTML.includes('spinner-border')) list.innerHTML = '';
            
            // 📦 UNPACK our hidden data from the email field
            const extra = JSON.parse(data.email);
            
            // Safely handle locations with apostrophes (like "King's Cross")
            const safeDest = extra.dest.replace(/'/g, "\\'");
            const safeEmbark = extra.embark.replace(/'/g, "\\'");
            
            list.innerHTML += `
                <div class="card border-success shadow-sm mb-2">
                    <div class="card-body p-2 d-flex justify-content-between align-items-center">
                        <div>
                            <strong class="text-success">${extra.vName}</strong><br>
                            <small class="text-muted">⭐ ${extra.vRating} Rating</small>
                        </div>
                        <button class="btn btn-sm btn-success" onclick="acceptOffer('${extra.vEmail}', '${extra.reqId}', ${data.lat}, ${data.lng}, '${safeDest}', '${safeEmbark}')">Choose</button>
                    </div>
                </div>
            `;
            // --- SCENARIO C: Passenger receives live GPS tracking updates from chosen volunteer ---
        } else if (data.type === 'update_location') {
            
            // SECURITY CHECK: Is this passenger waiting for a volunteer?
            if (currentUserRole === 'passenger' && currentVolunteerEmail && liveTrackingMap) {
                
                // 1. Unpack our Trojan Horse GPS data!
                const volExtra = JSON.parse(data.email);

                // Is this message from the specific volunteer we accepted?
                if (volExtra.vEmail === currentVolunteerEmail) {
                    const volPos = { lat: volExtra.vLat, lng: volExtra.vLng };
                    
                    // 2. Move or Create the Green Volunteer Marker
                    if (volunteerMarker) {
                        volunteerMarker.setPosition(volPos);
                    } else {
                        volunteerMarker = new google.maps.Marker({
                            position: volPos,
                            map: liveTrackingMap,
                            title: 'Your Volunteer',
                            icon: {
                                url: 'https://maps.google.com/mapfiles/ms/icons/green-dot.png', // Green marker for Helper
                                scaledSize: new google.maps.Size(40, 40) // Slightly bigger marker
                            }
                        });
                    }

                    // 3. Automatically fit the map to see BOTH Passenger and Volunteer
                    if (passengerMarker) {
                        const bounds = new google.maps.LatLngBounds();
                        bounds.extend(passengerMarker.getPosition());
                        bounds.extend(volPos);
                        liveTrackingMap.fitBounds(bounds);
                    }

                // 4. Calculate the Uber ETA Countdown using Google Distance Matrix
                    if (!distanceMatrixService) distanceMatrixService = new google.maps.DistanceMatrixService();
                    
                    // ✅ BUG 2 FIX: Changed passengerCoords to userCoords
                    if (userCoords) {
                        distanceMatrixService.getDistanceMatrix({
                            origins: [volPos], // Volunteer GPS
                            destinations: [userCoords], // Passenger GPS
                            travelMode: 'DRIVING', // Assume volunteer is driving for an accurate initial ETA
                        }, (response, status) => {
                            if (status === 'OK' && response.rows[0].elements[0].status === 'OK') {
                                const element = response.rows[0].elements[0];
                                const durationText = element.duration.text;
                                const distanceText = element.distance.text;
                                
                                // UPDATE HTML UI: Update the ETA countdown and distance!
                                document.getElementById('tracking-eta-text').innerText = durationText; // Shows e.g. "5 min"
                                document.getElementById('tracking-distance-text').innerText = distanceText + " away"; // Shows e.g. "2.1 km away"
                            }
                        });
                    }
                }
            }

      // --- SCENARIO D: Volunteer is chosen by the Passenger ---
        } else if (data.type === 'offer_accepted' && currentUserRole === 'volunteer') {
            try {
                // 📦 UNPACK our hidden data
                const extra = JSON.parse(data.email);
                const myEmail = document.getElementById('email').value || "Unknown";
                
                if (extra.vEmail === myEmail) {
                    alert("✅ The passenger chose you! Starting navigation.");
                    acceptRequest(extra.reqId, data.lat || 0, data.lng || 0, extra.dest, extra.embark, true, extra.routeIndex);
                }
            } catch(err) {
                console.error("Handshake Error:", err);
            }
            
        // ✅ BUG 1 FIX: ADDED THE MISSING PASSENGER LOGIC HERE!    
        } else if (data.type === 'offer_accepted' && currentUserRole === 'passenger') {
            const extra = JSON.parse(data.email);
            // 1. SAVE the volunteer's email globally for GPS scenario C!
            currentVolunteerEmail = extra.vEmail; 
            
            // 2. Swap screens and build the tracking map!
            switchToTrackingView();
        
        // --- SCENARIO E: Journey Completed (Passenger shows rating screen) ---
        } else if (data.type === 'job_completed' && currentUserRole === 'passenger') {
            alert("You have reached your destination! Please rate your volunteer.");
            
            // ✅ FIX: Hide both the selection map AND the live tracking map
            document.getElementById('map-container').style.display = 'none';
            document.getElementById('screen-passenger-tracking').style.display = 'none';
            
            // 2. Show the rating overlay
            document.getElementById('rating-overlay').style.display = 'block';
            window.scrollTo({ top: 0, behavior: 'smooth' });
            
            // 3. Save the volunteer's email so the rating goes to the right person
            currentVolunteerEmail = data.volunteerEmail;
            
            // 4. Stop broadcasting GPS to save battery
            if (liveTrackingId) navigator.geolocation.clearWatch(liveTrackingId);
        }

        
    };

}
        




// Continuously watches the phone's GPS and blasts it to AWS
function startBroadcastingGPS() {
    if (navigator.geolocation) {
        liveTrackingId = navigator.geolocation.watchPosition((pos) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    action: 'sync_location',
                    role: currentUserRole,
                    email: document.getElementById('email').value || "Guest",
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude
                }));
            }
        }, (err) => console.log("GPS Track Error:", err), { enableHighAccuracy: true });
    }
}

// ==========================================
// 2. NAVIGATION & AUTHENTICATION
// ==========================================

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active-screen'));
    const target = document.getElementById(screenId);
    if(target) target.classList.add('active-screen');
}

function handleActionClick(targetRole) {
    if (isLoggedIn) {
        if (currentUserRole !== targetRole) {
            alert(`Access Denied.\n\nYou are logged in as a ${currentUserRole.toUpperCase()}.`);
            return;
        }
        if (targetRole === 'passenger') showScreen('screen-passenger');
        else { showScreen('screen-volunteer'); loadVolunteerFeed(); }
    } else {
        showScreen('screen-login');
        switchLoginTab(targetRole);
    }
}

function checkLogin(role) { handleActionClick(role); }
function goToLogin() { showScreen('screen-login'); }

function logout() {
    isLoggedIn = false;
    currentUserRole = null; 
    
    // Stop live tracking when logging out
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
    alert("You have logged out.");
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

        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const role = document.getElementById('userRole').value; 
        const mode = document.getElementById('authMode').value; 
        const name = document.getElementById('fullName').value;
        const phone = document.getElementById('phone').value;

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
                isLoggedIn = true;
                currentUserRole = role; 
                currentUserName = data.name || "Volunteer"; 
                currentUserCredits = data.credits || 0;
                
                // ✅ NEW: Save rating data from the database
                currentUserRatingSum = data.ratingSum || 0; 
                currentUserRatingCount = data.ratingCount || 0; 
                
                // Connect to WebSocket automatically on login
                connectLiveTracking();
                alert(mode === 'signup' ? "Account Created! Logged in." : "Welcome back!");
                
                const loginBtn = document.getElementById('authBtn');
                if(loginBtn) {
                    loginBtn.innerHTML = 'Log Out';
                    loginBtn.setAttribute('onclick', 'logout()');
                }
                
                if (role === 'passenger') showScreen('screen-passenger');
                else { showScreen('screen-volunteer'); loadVolunteerFeed(); }
            } else {
                alert("Error: " + (data.error || "Unknown error"));
            }
        } catch (error) {
            console.error(error);
            alert("Connection Error.");
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    });
}

// ==========================================
// 3. PASSENGER LOGIC
// ==========================================

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
                console.log("GPS Error:", error);
                display.value = "GPS Error (Using Default)"; 
                userCoords = { lat: 51.505, lng: -0.09 }; 
            }
        );
    } else {
        display.value = "Location not supported";
    }
}

const reqForm = document.getElementById('requestForm');
if(reqForm) {
    reqForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!userCoords) {
            alert("Please click the target button to get your location first!");
            return;
        }

        const dest = document.getElementById('destination').value;
        
        try {
            document.getElementById('requestForm').style.display = 'none';
            document.getElementById('map-container').style.display = 'block';
            initGoogleMap(userCoords.lat, userCoords.lng, dest);
        } catch (err) {
            console.error("Error:", err);
            document.getElementById('requestForm').style.display = 'block';
        }
    });
}

async function confirmSelection() {
    const overlay = document.getElementById('connecting-overlay');
    
    // ✅ BUG FIX: Wipe the old volunteer offers and put the spinner back!
    const offersList = document.getElementById('volunteer-offers-list');
    if (offersList) {
        offersList.innerHTML = '<div class="text-center text-muted small spinner-border mx-auto" role="status"></div>';
    }

    if(overlay) {
        overlay.style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    const embarkation = document.getElementById('locationDisplay').value;
    // ... the rest of the function stays exactly the same
    const dest = document.getElementById('destination').value;
    const timeWindow = document.getElementById('timeWindow').value;
    
    const previewDest = document.getElementById('preview-dest');
    if(previewDest) previewDest.innerText = dest;

    try {
        await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'request_help', 
                email: document.getElementById('email').value || "Guest",
                embarkation: embarkation, 
                destination: dest,        
                timeWindow: timeWindow,   
                helpType: document.getElementById('helpType').value,
                lat: userCoords.lat,
                lng: userCoords.lng
            })
        });
        
        // START SHARING GPS SO VOLUNTEER CAN FIND THEM
        startBroadcastingGPS();

    } catch(err) {
        console.error("AWS Save Error:", err);
    }
}

function cancelRequest() {
    // ✅ FIX: Hide all connecting overlays and tracking maps!
    document.getElementById('connecting-overlay').style.display = 'none';
    document.getElementById('map-container').style.display = 'none';
    document.getElementById('screen-passenger-tracking').style.display = 'none'; 
    
    // Bring the request form back
    document.getElementById('requestForm').style.display = 'block';
    
    // Stop sharing GPS
    if (liveTrackingId) navigator.geolocation.clearWatch(liveTrackingId);
    
    alert("Request cancelled.");
}
// ==========================================
// 4. VOLUNTEER LOGIC
// ==========================================

async function loadVolunteerFeed() {
    const feed = document.getElementById('requests-feed');
    if(!feed) return;
    
    feed.innerHTML = `<div class="text-center py-4"><div class="spinner-border text-success"></div><p>Loading...</p></div>`;

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'get_requests' }) 
        });
        const data = await res.json();

        if (data.success && data.requests && data.requests.length > 0) {
            feed.innerHTML = data.requests.map(req => {
                const safeDest = (req.destination || 'Unknown Location').replace(/'/g, "\\'");
                const safeEmbark = (req.embarkation || 'Unknown Location').replace(/'/g, "\\'");
                const safeTime = req.timeWindow || 'ASAP';
                const safeType = req.helpType || 'General Help';

                return `
                <div class="card mb-3 border-0 shadow-sm">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <h5 class="card-title fw-bold text-dark mb-0">Passenger Request</h5>
                            <span class="badge bg-danger">${safeTime}</span>
                        </div>
                        
                        <p class="card-text text-muted small mb-1"><strong>Embarkation:</strong> ${safeEmbark}</p>
                        <p class="card-text text-muted small mb-2"><strong>Exit Stop:</strong> ${safeDest}</p>
                        <span class="badge bg-primary mb-3">${safeType}</span>
                        
                        <div class="d-grid">
                            <button class="btn btn-success fw-bold" 
                                onclick="sendOffer('${req.requestId}', ${req.lat || 0}, ${req.lng || 0}, '${safeDest}', '${safeEmbark}')">
                               Offer to Help <i class="fa-solid fa-hand-sparkles ms-2"></i>
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
        feed.innerHTML = `<p class="text-center text-danger">Could not connect to Cloud.</p>`;
    }
}

// ✅ FIX: Added passengerRouteIndex = 0
async function acceptRequest(requestId, passengerLat, passengerLng, destName, embarkName, skipConfirm = false, passengerRouteIndex = 0) {
    activeRequestId = requestId; 
    activeRouteIndex = passengerRouteIndex; // Save it to memory!

    // ✅ FIX: Only show the popup if we aren't skipping it
    if (!skipConfirm) {
        const agreementMessage = `Do you agree to help the passenger with embarkation at ${embarkName} and disembarkation at ${destName}?`;
        if (!confirm(agreementMessage)) return; 
    }

    try {
        // ... (Leave the rest of your fetch(API_URL) code exactly as it is)
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ 
                action: 'accept_help',
                requestId: requestId,
                volunteerEmail: document.getElementById('email').value || "Unknown"
             }) 
        });
        const data = await res.json();

        if (!data.success) {
            alert("Failed to accept request.");
            return;
        }
    } catch (err) {
         alert("Could not connect to server.");
         return;
    }

// ... existing acceptRequest logic ...
    try {
        // ... previous database fetch code (AWS Lambda lock) ...

        // ✅ NEW: Volunteer starts broadcasting their GPS location live!
        startLiveGpsBroadcasting();

    } catch (error) { // ... existing catch error ...
    }


document.getElementById('requests-feed').style.display = 'none';
    document.getElementById('volunteer-nav').style.display = 'block';
    
    // Reset buttons for a new job
    document.getElementById('btn-nearby').style.display = 'block';
    document.getElementById('btn-complete').style.display = 'none';
    document.getElementById('vol-nav-title').innerHTML = '<i class="fa-solid fa-person-walking-arrow-right"></i> Heading to Passenger';
    
    const statusText = document.getElementById('nav-dest');
    if(statusText) statusText.innerText = "Meeting at: " + embarkName;

    // Save globally for the "I'm Nearby" button
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
            // Store globally so imNearby can use it
            window.volDirRenderer = new google.maps.DirectionsRenderer({ 
                map: volMap,
                panel: document.getElementById('vol-directions-panel') // Shows text instructions
            });

            // Try Transit first, fallback to Walking
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
            
            startBroadcastingGPS();
        }, () => alert("GPS Error."));
    } else {
        alert("Geolocation is not supported.");
    }
}
// ==========================================
// 5. GOOGLE MAPS INIT
// ==========================================

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
    
    // Set global map so WebSocket knows where to draw the volunteer
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
                alert('No transport route found. Switching to walking.');
                directionsService.route({
                    origin: { lat: userLat, lng: userLng },
                    destination: destinationText, 
                    travelMode: 'WALKING'
                }, (res, stat) => {
                    if (stat === 'OK') directionsRenderer.setDirections(res);
                });
            } else {
                alert('Route Failed: ' + status);
            }
        }
    });
}

window.onload = function() {
    const destInput = document.getElementById('destination');
    if (destInput && google) {
        new google.maps.places.Autocomplete(destInput, {
            fields: ["formatted_address", "geometry", "name"],
            strictBounds: false,
            componentRestrictions: { country: "GB" } 
        });
    }
};
// Awards points to the Volunteer!
async function completeJob() {
    // Send API Request to award +1 Credit FIRST
    try {
        const email = document.getElementById('email').value || "Guest";
        
        // ✅ BLAST WEBSOCKET SIGNAL TO PASSENGER
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                action: 'sync_location', // Tricks our AWS route into broadcasting it
                type: 'job_completed',
                role: currentUserRole,
                volunteerEmail: email
            }));
        }

        await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ 
                action: 'complete_job',
                requestId: activeRequestId,
                volunteerEmail: email
             }) 
        });
        
        // Locally increase the credit so we don't have to reload from database
        currentUserCredits += 1;
        alert("✅ Job Complete! You earned +1 Volunteer Credit. Thank you for your help!");
        
    } catch(err) {
        console.error("Credit Error:", err);
        alert("Job complete, but there was an error updating your credits.");
    }

    // Stop sharing GPS and clear maps
    if (liveTrackingId) navigator.geolocation.clearWatch(liveTrackingId);
    if (otherPersonMarker) otherPersonMarker.setMap(null);
    otherPersonMarker = null;

    // Go back to the feed
    document.getElementById('volunteer-nav').style.display = 'none';
    document.getElementById('requests-feed').style.display = 'block';
    loadVolunteerFeed();
}

// ==========================================
// 6. PROFILE & CREDITS
// ==========================================
function loadProfile() {
    if (!isLoggedIn) {
        alert("Please log in to view your profile.");
        goToLogin();
        return;
    }

    // Update the visual text on the screen
    document.getElementById('profile-name').innerText = currentUserName;
    document.getElementById('profile-role').innerText = currentUserRole.toUpperCase();
    
    // Only show credits & rating if they are a volunteer
    if (currentUserRole === 'volunteer') {
        document.getElementById('volunteer-stats').style.display = 'block';
        document.getElementById('profile-credits').innerText = currentUserCredits;
        
        // ✅ NEW: Calculate the average rating!
        let avgRating = 5.0; // Default to 5.0 if they have no ratings yet
        if (currentUserRatingCount > 0) {
            // Divide total stars by number of reviews, and round to 1 decimal place (e.g. 4.8)
            avgRating = (currentUserRatingSum / currentUserRatingCount).toFixed(1);
        }
        document.getElementById('profile-rating').innerText = avgRating;
        
    } else {
        document.getElementById('volunteer-stats').style.display = 'none';
    }

    // Switch to the Profile Screen and update navbar highlighting
    showScreen('screen-profile');
    document.querySelectorAll('.nav-link').forEach(t => t.classList.remove('active'));
    // Make the profile button active (it's the 4th button in the nav)
    document.querySelectorAll('.bottom-nav .nav-link')[3].classList.add('active');
}

// ==========================================
// 7. RATING SYSTEM
// ==========================================

function setRating(stars) {
    selectedRating = stars;
    const starElements = document.querySelectorAll('#star-container i');
    
    // Turn clicked stars gold, and unclicked stars grey
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
        await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'submit_rating',
                volunteerEmail: currentVolunteerEmail,
                rating: selectedRating
            })
        });
        alert("Thanks for your feedback!");
    } catch(err) {
        console.error("Rating error:", err);
    }
    
    // ✅ FIX: Wipe the tracking screen clean and reset everything!
    document.getElementById('rating-overlay').style.display = 'none';
    document.getElementById('screen-passenger-tracking').style.display = 'none'; 
    document.getElementById('requestForm').style.display = 'block'; 
    
    // Go home
    showScreen('screen-home');
}

function acceptOffer(volEmail, reqId, lat, lng, dest, embark) {
    document.getElementById('connecting-overlay').style.display = 'none';
    alert("You selected a volunteer! They are now routing to your location.");
    
   // 🕵️ TROJAN HORSE: Hide our custom data inside a JSON string
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

    // ✅ THE FIX: Don't wait for AWS! Instantly switch to the tracking map locally.
    currentVolunteerEmail = volEmail;
    switchToTrackingView();
}

function sendOffer(requestId, passengerLat, passengerLng, destName, embarkName) {
    alert("Offer sent! Waiting for the passenger to choose you...");
    
    let rating = 5.0;
    if (currentUserRatingCount > 0) {
        rating = (currentUserRatingSum / currentUserRatingCount).toFixed(1);
    }

    // 🕵️ TROJAN HORSE: Hide our custom data inside a JSON string
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
            email: packedData, // Sneaking it past the AWS bouncer
            lat: passengerLat, 
            lng: passengerLng
        }));
    }
}

function imNearby() {
    // 1. Swap the buttons
    document.getElementById('btn-nearby').style.display = 'none';
    document.getElementById('btn-complete').style.display = 'block';
    
    // 2. Update the Text
    document.getElementById('vol-nav-title').innerHTML = '<i class="fa-solid fa-route"></i> Navigating to Destination';
    document.getElementById('nav-dest').innerText = "Heading to: " + activeDestination;

   // 3. Clear the old route and draw the new one!
    const dirService = new google.maps.DirectionsService();
    
    dirService.route({
        origin: activePassengerCoords, 
        destination: activeDestination, 
        travelMode: 'TRANSIT',
        provideRouteAlternatives: true, // ✅ MUST BE TRUE to generate the same alternatives!
        transitOptions: { modes: ['SUBWAY', 'TRAIN', 'BUS'], routingPreference: 'FEWER_TRANSFERS' }
    }, (result, status) => {
        if (status === 'OK') {
            window.volDirRenderer.setDirections(result);
            // 🎯 THIS IS THE MAGIC LINE: Force it to show the exact route the passenger chose
            window.volDirRenderer.setRouteIndex(activeRouteIndex || 0);
        } else {
            // Fallback to walking if no buses exist
            dirService.route({
                origin: activePassengerCoords,
                destination: activeDestination,
                travelMode: 'WALKING'
            }, (res, stat) => {
                if (stat === 'OK') window.volDirRenderer.setDirections(res);
            });
        }
    });
    
    alert("You have met the passenger! The map has updated to show your final destination.");
}

function startLiveGpsBroadcasting() {
    // Only proceed if browser supports GPS and WebSocket is open
    if (navigator.geolocation && ws && ws.readyState === WebSocket.OPEN) {
        // Starts a high-accuracy GPS watch that automatically triggers when the phone moves
        liveTrackingId = navigator.geolocation.watchPosition((position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            
            // Broadcast GPS through your Trojan Horse Trojan hidden inside 'email'
            const packedData = JSON.stringify({
                vEmail: document.getElementById('email').value || "Unknown",
                vLat: lat,
                vLng: lng
            });

            ws.send(JSON.stringify({
                action: 'sync_location', 
                type: 'update_location', 
                role: 'volunteer',
                email: packedData // Sneaking current GPS past AWS!
            }));
        }, () => console.error("High Accuracy Geolocation access denied."), { enableHighAccuracy: true });
    }
}


function switchToTrackingView() {
    // 1. Swap visibility to the dedicated tracking screen
    document.getElementById('map-container').style.display = 'none'; // Clear selection map
    document.getElementById('connecting-overlay').style.display = 'none'; // Clear overlay
    document.getElementById('screen-passenger-tracking').style.display = 'block'; // Show live tracking map
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // 2. Initialize the fresh tracking map centered on the Passenger
    const mapDiv = document.getElementById('live-tracking-map');
    
    // ✅ BUG 2 FIX: Changed passengerCoords to userCoords
    const mapPos = userCoords || { lat: 51.5, lng: -0.1 }; 
    
    liveTrackingMap = new google.maps.Map(mapDiv, {
        zoom: 16,
        center: mapPos,
        disableDefaultUI: true 
    });

    // 3. Draw the Passenger's Marker
    if(userCoords) {
        passengerMarker = new google.maps.Marker({
            position: userCoords,
            map: liveTrackingMap,
            title: 'Your Location'
        });
    }
}