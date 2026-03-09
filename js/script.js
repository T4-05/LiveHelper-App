// ✅ REST API (For Login/Database)
const API_URL = 'https://adspkvmkg1.execute-api.us-east-1.amazonaws.com/default/LiveHelper-Login';

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

        // --- SCENARIO B: We receive the "Job Completed" signal from the Volunteer ---
        } else if (data.type === 'job_completed' && currentUserRole === 'passenger') {
            currentVolunteerEmail = data.volunteerEmail;
            
            // Hide the map and show the rating overlay
            document.getElementById('map-container').style.display = 'none';
            document.getElementById('rating-overlay').style.display = 'block';
            setRating(5); // Reset to 5 stars
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
    if(overlay) {
        overlay.style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    const embarkation = document.getElementById('locationDisplay').value;
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
    document.getElementById('connecting-overlay').style.display = 'none';
    document.getElementById('map-container').style.display = 'none';
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
                                onclick="acceptRequest('${req.requestId}', ${req.lat || 0}, ${req.lng || 0}, '${safeDest}', '${safeEmbark}')">
                                Accept & Navigate <i class="fa-solid fa-location-arrow ms-2"></i>
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

async function acceptRequest(requestId, passengerLat, passengerLng, destName, embarkName) {
    activeRequestId = requestId; // Remember the job ID
    
    const agreementMessage = `Do you agree to help the passenger with embarkation at ${embarkName} and disembarkation at ${destName}?`;
    if (!confirm(agreementMessage)) return; 

    try {
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

    document.getElementById('requests-feed').style.display = 'none';
    document.getElementById('volunteer-nav').style.display = 'block';
    
    const statusText = document.getElementById('nav-dest');
    if(statusText) statusText.innerText = "Heading to: " + destName;

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((position) => {
            const volLat = position.coords.latitude;
            const volLng = position.coords.longitude;

            const mapDiv = document.getElementById('volunteer-map');
            const volMap = new google.maps.Map(mapDiv, {
                zoom: 15,
                center: { lat: volLat, lng: volLng },
                disableDefaultUI: true 
            });
            
            // Set global map so WebSocket knows where to draw the passenger
            globalActiveMap = volMap;

            const dirService = new google.maps.DirectionsService();
            const dirRenderer = new google.maps.DirectionsRenderer({ map: volMap });

            dirService.route({
                origin: { lat: volLat, lng: volLng },
                destination: { lat: passengerLat, lng: passengerLng },
                travelMode: 'WALKING'
            }, (result, status) => {
                if (status === 'OK') dirRenderer.setDirections(result);
            });
            
            // START SHARING GPS SO PASSENGER CAN TRACK THEM
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
    if (destInput && google) new google.maps.places.Autocomplete(destInput);
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
    
    // Clean up and return to the home screen
    document.getElementById('rating-overlay').style.display = 'none';
    document.getElementById('requestForm').style.display = 'block'; // Reset form for next time
    showScreen('screen-home');
}