const API_URL = 'https://7cgcgrivhhqbo3mnbcvv3tftwm0deicc.lambda-url.eu-north-1.on.aws/';
const WS_URL = 'wss://6hir0irra5.execute-api.eu-north-1.amazonaws.com/production/';

let isLoggedIn = false;
let currentUserRole = null;
let currentUserName = "User";
let currentUserCredits = 0;
let activeRequestId = null;
let currentVolunteerEmail = "";
let selectedRating = 5;
let userCoords = null;
let currentUserRatingSum = 0;
let currentUserRatingCount = 0;

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


// override default alert with bootstrap modal
window.alert = function(message) {
    document.getElementById('customModalTitle').innerText = "LiveHelper";
    document.getElementById('customModalBody').innerText = message;

    var footer = document.getElementById('customModalFooter');
    footer.innerHTML = `<button type="button" class="btn btn-primary px-4 rounded-pill" data-bs-dismiss="modal">OK</button>`;

    var modalEl = document.getElementById('customModal');
    var modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    modal.show();
};

// confirm dialog using bootstrap modal
function customConfirm(message, title) {
    if (!title) title = "Please Confirm";

    return new Promise(function(resolve) {
        document.getElementById('customModalTitle').innerText = title;
        document.getElementById('customModalBody').innerText = message;

        var footer = document.getElementById('customModalFooter');
        footer.innerHTML = `
            <button type="button" class="btn btn-light border px-3 rounded-pill" data-bs-dismiss="modal" id="btnConfirmCancel">Cancel</button>
            <button type="button" class="btn btn-primary px-4 rounded-pill" data-bs-dismiss="modal" id="btnConfirmOk">I Agree</button>
        `;

        var modalEl = document.getElementById('customModal');
        var modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);

        document.getElementById('btnConfirmOk').onclick = function() { resolve(true); };
        document.getElementById('btnConfirmCancel').onclick = function() { resolve(false); };

        // clicking outside = cancel
        modalEl.addEventListener('hidden.bs.modal', function handler() {
            resolve(false);
            modalEl.removeEventListener('hidden.bs.modal', handler);
        });

        modal.show();
    });
}


var liveTrackingMap = null;
var passengerMarker = null;
var volunteerMarker = null;
var distanceMatrixService = null;

// websocket connection for live tracking
function connectLiveTracking() {
    if (ws) return;

    ws = new WebSocket(WS_URL);
    ws.onopen = function() {
        console.log("ws connected");
    };

    ws.onmessage = function(event) {
        var data = JSON.parse(event.data);

        if (data.type === 'live_gps' && data.role !== currentUserRole) {

            // hide searching overlay when volunteer starts broadcasting
            if (currentUserRole == 'passenger' && data.role == 'volunteer') {
                var overlay = document.getElementById('connecting-overlay');
                if (overlay && overlay.style.display === 'block') {
                    overlay.style.display = 'none';
                    alert("A volunteer has accepted your request and is on their way!");
                }
            }

            if (globalActiveMap) {
                var newPos = { lat: data.lat, lng: data.lng };

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

        } else if (data.type === 'volunteer_offer' && currentUserRole === 'passenger') {
            var list = document.getElementById('volunteer-offers-list');
            if (list.innerHTML.includes('spinner-border')) list.innerHTML = '';

            var extra = JSON.parse(data.email);

            // escape apostrophes for onclick
            var safeDest = extra.dest.replace(/'/g, "\\'");
            var safeEmbark = extra.embark.replace(/'/g, "\\'");

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

        } else if (data.type === 'update_location') {
            if (currentUserRole === 'passenger' && currentVolunteerEmail && liveTrackingMap) {
                var volExtra = JSON.parse(data.email);

                if (volExtra.vEmail === currentVolunteerEmail) {
                    var volPos = { lat: volExtra.vLat, lng: volExtra.vLng };

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

                    if (passengerMarker) {
                        var bounds = new google.maps.LatLngBounds();
                        bounds.extend(passengerMarker.getPosition());
                        bounds.extend(volPos);
                        liveTrackingMap.fitBounds(bounds);
                    }

                    // eta calculation
                    if (!distanceMatrixService) {
                        distanceMatrixService = new google.maps.DistanceMatrixService();
                    }
                    if (userCoords) {
                        distanceMatrixService.getDistanceMatrix({
                            origins: [volPos],
                            destinations: [userCoords],
                            travelMode: 'DRIVING',
                        }, function(response, status) {
                            if (status === 'OK' && response.rows[0].elements[0].status === 'OK') {
                                var el = response.rows[0].elements[0];
                                document.getElementById('tracking-eta-text').innerText = el.duration.text;
                                document.getElementById('tracking-distance-text').innerText = el.distance.text + " away";
                            }
                        });
                    }
                }
            }

        } else if (data.type === 'offer_accepted' && currentUserRole === 'volunteer') {
            try {
                var extra = JSON.parse(data.email);
                var myEmail = document.getElementById('email').value || "Unknown";

                if (extra.vEmail === myEmail) {
                    alert("The passenger chose you! Starting navigation.");
                    acceptRequest(extra.reqId, data.lat || 0, data.lng || 0, extra.dest, extra.embark, true, extra.routeIndex);
                } else {
                    loadVolunteerFeed();
                }
            } catch(e) {
                console.error("handshake error:", e);
            }

        } else if (data.type === 'refresh_feeds' && currentUserRole === 'volunteer') {
            if (document.getElementById('screen-volunteer').classList.contains('active-screen')) {
                loadVolunteerFeed();
            }

        } else if (data.type === 'offer_accepted' && currentUserRole === 'passenger') {
            var extra = JSON.parse(data.email);
            currentVolunteerEmail = extra.vEmail;
            switchToTrackingView();

        } else if (data.type == 'job_completed' && currentUserRole == 'passenger') {
            alert("You have reached your destination! Please rate your volunteer.");

            document.getElementById('map-container').style.display = 'none';
            document.getElementById('screen-passenger-tracking').style.display = 'none';
            document.getElementById('rating-overlay').style.display = 'block';
            window.scrollTo({ top: 0, behavior: 'smooth' });

            currentVolunteerEmail = data.volunteerEmail;

            if (liveTrackingId) navigator.geolocation.clearWatch(liveTrackingId);

        } else if (data.type === 'rating_updated' && currentUserRole === 'volunteer') {
            var myEmail = document.getElementById('email').value || "Unknown";

            if (data.email == myEmail) {
                currentUserRatingSum += data.lat;
                currentUserRatingCount += 1;

                if (document.getElementById('screen-profile').classList.contains('active-screen')) {
                    loadProfile();
                }
            }

        } else if (data.type === 'job_cancelled_mid_trip' && currentUserRole === 'volunteer') {
            var myEmail = document.getElementById('email').value || "Unknown";

            if (data.email == myEmail) {
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

function startBroadcastingGPS() {
    if (navigator.geolocation) {
        liveTrackingId = navigator.geolocation.watchPosition(function(pos) {
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
        }, function(err) {
            console.log("gps err:", err);
        }, { enableHighAccuracy: true });
    }
}

function updateUIVisibility() {
    var homePassenger = document.getElementById('home-card-passenger');
    var homeVolunteer = document.getElementById('home-card-volunteer');
    var navPassenger = document.getElementById('nav-tab-passenger');
    var navVolunteer = document.getElementById('nav-tab-volunteer');

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


function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(function(s) {
        s.classList.remove('active-screen');
    });
    var target = document.getElementById(screenId);
    if(target) target.classList.add('active-screen');

    var bottomNavs = document.querySelectorAll('.bottom-nav .nav-link');
    if (bottomNavs.length > 0) {
        bottomNavs.forEach(function(nav) { nav.classList.remove('active'); });

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
        return;
    }

    if (role === 'passenger') {
        showScreen('screen-passenger');
    } else {
        showScreen('screen-volunteer');
        loadVolunteerFeed();
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

    var btn = document.getElementById('authBtn');
    if(btn) {
        btn.innerHTML = 'Log In <i class="fa-solid fa-arrow-right-to-bracket"></i>';
        btn.setAttribute('onclick', 'goToLogin()');
    }
    showScreen('screen-home');
    alert("Logged out.");

    updateUIVisibility();
}

function switchLoginTab(role) {
    var roleInput = document.getElementById('userRole');
    if(roleInput) roleInput.value = role;

    document.querySelectorAll('.nav-link').forEach(function(t) { t.classList.remove('active'); });
    if(role === 'passenger') document.getElementById('tab-passenger').classList.add('active');
    else document.getElementById('tab-volunteer').classList.add('active');
}

function toggleAuthMode() {
    var modeInput = document.getElementById('authMode');
    var title = document.getElementById('auth-title');
    var btn = document.getElementById('submitBtn');
    var toggleText = document.getElementById('toggleText');
    var signupFields = document.getElementById('signup-fields');

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

var authForm = document.getElementById('authForm');
if(authForm) {
    authForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        var btn = document.getElementById('submitBtn');
        var originalText = btn.innerHTML;
        btn.innerHTML = 'Connecting...';
        btn.disabled = true;

        var email = document.getElementById('email').value.trim();
        var password = document.getElementById('password').value;
        var role = document.getElementById('userRole').value;
        var mode = document.getElementById('authMode').value;
        var name = document.getElementById('fullName').value.trim();
        var phone = document.getElementById('phone').value.trim();

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            alert("Please enter a valid email.");
            btn.innerHTML = originalText;
            btn.disabled = false;
            return;
        }
        if (password.length < 6) {
            alert("Password must be at least 6 characters.");
            btn.innerHTML = originalText;
            btn.disabled = false;
            return;
        }

        if (mode === 'signup') {
            if (!/^[a-zA-Z\s]{2,50}$/.test(name)) {
                alert("Please enter a valid name.");
                btn.innerHTML = originalText;
                btn.disabled = false;
                return;
            }
            if (!/^\+?[0-9]{10,15}$/.test(phone)) {
                alert("Please enter a valid phone number.");
                btn.innerHTML = originalText;
                btn.disabled = false;
                return;
            }
        }

        try {
            var response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: mode,
                    email, password, role,
                    name: mode === 'signup' ? name : undefined,
                    phone: mode === 'signup' ? phone : undefined
                })
            });
            var data = await response.json();

            if (data.success) {
                if (mode === 'login' && data.role && data.role !== role) {
                    alert("Account registered as " + data.role + ". Switch tabs to log in.");
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                    return;
                }

                isLoggedIn = true;
                currentUserRole = data.role || role;

                var safeName = name.trim() !== '' ? name : "New User";
                currentUserName = mode === 'signup' ? safeName : (data.name || "New User");
                currentUserCredits = data.credits || 0;
                currentUserRatingSum = data.ratingSum || 0;
                currentUserRatingCount = data.ratingCount || 0;

                updateUIVisibility();
                connectLiveTracking();

                var loginBtn = document.getElementById('authBtn');
                if(loginBtn) {
                    loginBtn.innerHTML = 'Log Out';
                    loginBtn.setAttribute('onclick', 'logout()');
                }

                if (currentUserRole === 'passenger') {
                    showScreen('screen-passenger');
                } else {
                    showScreen('screen-volunteer');
                    loadVolunteerFeed();
                }
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


function getGPS() {
    var display = document.getElementById('locationDisplay');
    display.value = "Locating...";

    if (!navigator.geolocation) {
        alert("Location not supported.");
        return;
    }

    navigator.geolocation.getCurrentPosition(
        function(pos) {
            var lat = pos.coords.latitude;
            var lng = pos.coords.longitude;
            userCoords = { lat: lat, lng: lng };

            var geocoder = new google.maps.Geocoder();
            geocoder.geocode({ location: { lat: lat, lng: lng } }, function(results, status) {
                if (status === "OK" && results[0]) {
                    display.value = results[0].formatted_address;
                } else {
                    display.value = `📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
                }
            });
        },
        function(error) {
            console.log("gps error:", error);
            display.value = "";
            alert("Could not locate automatically. Please type it in.");
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

var reqForm = document.getElementById('requestForm');
if(reqForm) {
    reqForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        var embarkVal = document.getElementById('locationDisplay').value.trim();
        var dest = document.getElementById('destination').value;

        if (!embarkVal) {
            alert("Please enter a starting location.");
            return;
        }

        function processRequest() {
            document.getElementById('requestForm').style.display = 'none';
            document.getElementById('map-container').style.display = 'block';
            initGoogleMap(userCoords.lat, userCoords.lng, dest);
        }

        if (!userCoords) {
            var geocoder = new google.maps.Geocoder();
            geocoder.geocode({ address: embarkVal + ", London, UK", bounds: new google.maps.LatLngBounds(
                new google.maps.LatLng(51.286760, -0.510375), new google.maps.LatLng(51.691874, 0.334015)
            )}, function(results, status) {
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
    var overlay = document.getElementById('connecting-overlay');
    var offersList = document.getElementById('volunteer-offers-list');

    if (offersList) {
        offersList.innerHTML = '<div class="text-center text-muted small spinner-border mx-auto" role="status"></div>';
    }

    if(overlay) {
        overlay.style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    var embarkation = document.getElementById('locationDisplay').value || "Current Location";
    var dest = document.getElementById('destination').value || "Anywhere";
    var timeWindow = document.getElementById('timeWindow') ? document.getElementById('timeWindow').value : "ASAP";
    var hType = document.getElementById('helpType') ? document.getElementById('helpType').value : "General";

    var finalLat = userCoords ? userCoords.lat : 51.5074;
    var finalLng = userCoords ? userCoords.lng : -0.1278;

    try {
        var response = await fetch(API_URL, {
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

        var data = await response.json();

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
            console.error("cancel err", err);
        }
    }

    currentVolunteerEmail = "";
    alert("Request cancelled.");
}


async function loadVolunteerFeed() {
    var feed = document.getElementById('requests-feed');
    if(!feed) return;

    feed.innerHTML = `<div class="text-center py-4"><div class="spinner-border text-success"></div><p>Loading...</p></div>`;

    try {
        var res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'get_volunteer_feed' })
        });
        var data = await res.json();

        var validRequests = [];
        if (data.success && data.requests) {
            for (var i = 0; i < data.requests.length; i++) {
                var req = data.requests[i];
                var embark = req.embarkation || req.startLocation || "";
                var dest = req.destination || "";

                if (req.lat !== undefined && req.lng !== undefined &&
                    embark.trim() !== "" && embark !== "Unknown Location" &&
                    dest.trim() !== "") {
                    validRequests.push(req);
                }
            }
        }

        if (validRequests.length > 0) {
            var html = "";
            for (var i = 0; i < validRequests.length; i++) {
                var req = validRequests[i];
                var safeDest = req.destination.replace(/'/g, "\\'");
                var safeEmbark = (req.embarkation || req.startLocation).replace(/'/g, "\\'");
                var safeTime = req.timeWindow || 'ASAP';
                var safeType = req.helpType || 'General Help';

                html += `
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
            }
            feed.innerHTML = html;
        } else {
            feed.innerHTML = `<p class="text-center text-muted">No active requests found.</p>`;
        }
    } catch (err) {
        feed.innerHTML = `<p class="text-center text-danger">Could not connect to server.</p>`;
    }
}

async function acceptRequest(requestId, passengerLat, passengerLng, destName, embarkName, skipConfirm, passengerRouteIndex) {
    activeRequestId = requestId;
    activeRouteIndex = passengerRouteIndex || 0;

    if (!skipConfirm) {
        var agreementMessage = `Do you agree to help the passenger from ${embarkName} to ${destName}?`;
        var isConfirmed = await customConfirm(agreementMessage);
        if (!isConfirmed) return;
    }

    try {
        var res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'accept_request',
                passengerEmail: requestId,
                volunteerEmail: document.getElementById('email').value || "Unknown",
                volunteerName: currentUserName
             })
        });
        var data = await res.json();

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

    var statusText = document.getElementById('nav-dest');
    if(statusText) statusText.innerText = "Meeting at: " + embarkName;

    activePassengerCoords = { lat: passengerLat, lng: passengerLng };
    activeDestination = destName;

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(function(position) {
            var volLat = position.coords.latitude;
            var volLng = position.coords.longitude;

            var mapDiv = document.getElementById('volunteer-map');
            var volMap = new google.maps.Map(mapDiv, {
                zoom: 14,
                center: { lat: volLat, lng: volLng },
                disableDefaultUI: true
            });

            globalActiveMap = volMap;

            var dirService = new google.maps.DirectionsService();
            window.volDirRenderer = new google.maps.DirectionsRenderer({
                map: volMap,
                panel: document.getElementById('vol-directions-panel')
            });

            dirService.route({
                origin: { lat: volLat, lng: volLng },
                destination: { lat: passengerLat, lng: passengerLng },
                travelMode: 'TRANSIT',
                transitOptions: { modes: ['SUBWAY', 'TRAIN', 'BUS'] }
            }, function(result, status) {
                if (status === 'OK') {
                    window.volDirRenderer.setDirections(result);
                } else {
                    dirService.route({
                        origin: { lat: volLat, lng: volLng },
                        destination: { lat: passengerLat, lng: passengerLng },
                        travelMode: 'WALKING'
                    }, function(res, stat) {
                        if (stat === 'OK') window.volDirRenderer.setDirections(res);
                    });
                }
            });

        }, function() { alert("GPS Error."); });
    } else {
        alert("Geolocation not supported.");
    }
}


function initGoogleMap(userLat, userLng, destinationText) {
    var mapContainer = document.getElementById('google-map');
    var panelContainer = document.getElementById('directions-panel');

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
        } else if (status === 'ZERO_RESULTS') {
            alert('No transit route found, falling back to walking.');
            directionsService.route({
                origin: { lat: userLat, lng: userLng },
                destination: destinationText,
                travelMode: 'WALKING'
            }, function(res, stat) {
                if (stat === 'OK') directionsRenderer.setDirections(res);
            });
        } else {
            alert('Route error: ' + status);
        }
    });
}

window.onload = function() {
    var destInput = document.getElementById('destination');
    var startInput = document.getElementById('locationDisplay');

    if (google) {
        var londonBounds = new google.maps.LatLngBounds(
            new google.maps.LatLng(51.286760, -0.510375),
            new google.maps.LatLng(51.691874, 0.334015)
        );

        var autocompleteOptions = {
            bounds: londonBounds,
            strictBounds: true,
            fields: ["formatted_address", "geometry", "name"],
            componentRestrictions: { country: "GB" }
        };

        if (destInput) new google.maps.places.Autocomplete(destInput, autocompleteOptions);

        if (startInput) {
            var startAutocomplete = new google.maps.places.Autocomplete(startInput, autocompleteOptions);
            startAutocomplete.addListener('place_changed', function() {
                var place = startAutocomplete.getPlace();
                if (place.geometry) {
                    userCoords = { lat: place.geometry.location.lat(), lng: place.geometry.location.lng() };
                }
            });
        }
    }
};

async function completeJob() {
    var email = document.getElementById('email').value || "Guest";

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            action: 'sync_location',
            type: 'job_completed',
            role: currentUserRole,
            volunteerEmail: email
        }));
    }

    try {
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

function loadProfile() {
    if (!isLoggedIn) {
        alert("Please log in.");
        goToLogin();
        return;
    }

    document.getElementById('profile-name').innerText = currentUserName;
    document.getElementById('profile-role').innerText = currentUserRole.toUpperCase();

    var avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUserName)}&background=eff6ff&color=2563eb&size=100&rounded=true`;
    document.getElementById('profile-avatar').src = avatarUrl;

    if (currentUserRole === 'volunteer') {
        document.getElementById('volunteer-stats').style.display = 'block';
        document.getElementById('profile-credits').innerText = currentUserCredits;

        var avgRating = "New";
        if (currentUserRatingCount > 0) {
            avgRating = (currentUserRatingSum / currentUserRatingCount).toFixed(1);
        }
        document.getElementById('profile-rating').innerText = avgRating;
    } else {
        document.getElementById('volunteer-stats').style.display = 'none';
    }

    showScreen('screen-profile');

    document.querySelectorAll('.nav-link').forEach(function(t) { t.classList.remove('active'); });
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

    var btn = document.getElementById('settingsSaveBtn');
    btn.innerHTML = 'Saving...';
    btn.disabled = true;

    var newName = document.getElementById('settingsName').value.trim();
    var newPhone = document.getElementById('settingsPhone').value.trim();
    var newPassword = document.getElementById('settingsPassword').value;

    try {
        var response = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'update_profile',
                email: document.getElementById('settingsEmail').value,
                name: newName,
                phone: newPhone,
                password: newPassword
            })
        });
        var data = await response.json();

        if (data.success) {
            currentUserName = newName;
            alert("Profile updated.");
            loadProfile();
        } else {
            alert("Error: " + data.error);
        }
    } catch (err) {
        alert("Connection error.");
    }

    btn.innerHTML = 'Save Changes';
    btn.disabled = false;
}

function setRating(stars) {
    selectedRating = stars;
    var allStars = document.querySelectorAll('#star-container i');

    for (var i = 0; i < allStars.length; i++) {
        if (i < stars) {
            allStars[i].classList.remove('text-muted');
            allStars[i].classList.add('text-warning');
        } else {
            allStars[i].classList.remove('text-warning');
            allStars[i].classList.add('text-muted');
        }
    }
}

async function submitRating() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            action: 'sync_location',
            type: 'rating_updated',
            role: 'passenger',
            email: currentVolunteerEmail,
            lat: selectedRating,
            lng: 0
        }));
    }

    try {
        await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'submit_rating',
                volunteerEmail: currentVolunteerEmail,
                rating: selectedRating
            })
        });
    } catch(err) {
        console.error("rating err", err);
    }

    document.getElementById('rating-overlay').style.display = 'none';
    document.getElementById('screen-passenger-tracking').style.display = 'none';
    document.getElementById('requestForm').style.display = 'block';

    showScreen('screen-home');
}

function acceptOffer(volEmail, reqId, lat, lng, dest, embark) {
    document.getElementById('connecting-overlay').style.display = 'none';

    var packedData = JSON.stringify({
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

    var rating = "New";
    if (currentUserRatingCount > 0) {
        rating = (currentUserRatingSum / currentUserRatingCount).toFixed(1);
    }

    var packedData = JSON.stringify({
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

    var dirService = new google.maps.DirectionsService();

    dirService.route({
        origin: activePassengerCoords,
        destination: activeDestination,
        travelMode: 'TRANSIT',
        provideRouteAlternatives: true,
        transitOptions: { modes: ['SUBWAY', 'TRAIN', 'BUS'], routingPreference: 'FEWER_TRANSFERS' }
    }, function(result, status) {
        if (status === 'OK') {
            window.volDirRenderer.setDirections(result);
            window.volDirRenderer.setRouteIndex(activeRouteIndex || 0);
        } else {
            dirService.route({
                origin: activePassengerCoords,
                destination: activeDestination,
                travelMode: 'WALKING'
            }, function(res, stat) {
                if (stat === 'OK') window.volDirRenderer.setDirections(res);
            });
        }
    });
}

function startLiveGpsBroadcasting() {
    if (!navigator.geolocation) return;

    liveTrackingId = navigator.geolocation.watchPosition(function(position) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        var lat = position.coords.latitude;
        var lng = position.coords.longitude;

        var packedData = JSON.stringify({
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
    }, function() {
        console.error("geo access denied");
    }, { enableHighAccuracy: true });
}

function switchToTrackingView() {
    document.getElementById('map-container').style.display = 'none';
    document.getElementById('connecting-overlay').style.display = 'none';
    document.getElementById('screen-passenger-tracking').style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });

    var mapDiv = document.getElementById('live-tracking-map');
    var mapPos = userCoords || { lat: 51.5, lng: -0.1 };

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
