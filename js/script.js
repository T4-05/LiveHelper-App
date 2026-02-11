// ✅ CONNECTED TO YOUR AWS CLOUD
const API_URL = 'https://adspkvmkg1.execute-api.us-east-1.amazonaws.com/default/LiveHelper-Login';

// GLOBAL STATE
let isLoggedIn = false;
let currentUserRole = null; // 🔒 NEW: Stores "passenger" or "volunteer"
let userCoords = null; 
let map = null;
let directionsService = null;
let directionsRenderer = null;

// --- NAVIGATION ---
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active-screen'));
    const target = document.getElementById(screenId);
    if(target) target.classList.add('active-screen');
}

function handleActionClick(targetRole) {
    if (isLoggedIn) {
        // 🔒 SECURITY CHECK: Prevent switching sides
        if (currentUserRole !== targetRole) {
            alert(`⛔ Access Denied.\n\nYou are logged in as a ${currentUserRole.toUpperCase()}.\nPlease log out if you want to sign in as a ${targetRole}.`);
            return;
        }

        // If roles match, allow access
        if (targetRole === 'passenger') showScreen('screen-passenger');
        else { showScreen('screen-volunteer'); loadVolunteerFeed(); }
    } else {
        // If not logged in, send them to login screen with the correct tab
        showScreen('screen-login');
        switchLoginTab(targetRole);
    }
}

function checkLogin(role) { handleActionClick(role); }
function goToLogin() { showScreen('screen-login'); }

function logout() {
    isLoggedIn = false;
    currentUserRole = null; // 🔒 Clear the role
    const btn = document.getElementById('authBtn');
    if(btn) {
        btn.innerHTML = 'Log In <i class="fa-solid fa-arrow-right-to-bracket"></i>';
        btn.setAttribute('onclick', 'goToLogin()');
    }
    showScreen('screen-home');
    alert("You have logged out.");
}

// --- LOGIN LOGIC ---
function switchLoginTab(role) {
    const roleInput = document.getElementById('userRole');
    if(roleInput) roleInput.value = role;
    
    document.querySelectorAll('.nav-link').forEach(t => t.classList.remove('active'));
    if(role === 'passenger') {
        const tab = document.getElementById('tab-passenger');
        if(tab) tab.classList.add('active');
    } else {
        const tab = document.getElementById('tab-volunteer');
        if(tab) tab.classList.add('active');
    }
}

// --- TOGGLE BETWEEN LOGIN & SIGNUP ---
function toggleAuthMode() {
    const modeInput = document.getElementById('authMode');
    const title = document.getElementById('auth-title');
    const btn = document.getElementById('submitBtn');
    const toggleText = document.getElementById('toggleText');
    const signupFields = document.getElementById('signup-fields');

    if (modeInput.value === 'login') {
        // Switch to Sign Up
        modeInput.value = 'signup';
        title.innerText = "Create Account";
        btn.innerText = "Sign Up";
        toggleText.innerHTML = 'Already have an account? <a href="#" onclick="toggleAuthMode()">Log In</a>';
        signupFields.style.display = 'block';
    } else {
        // Switch back to Login
        modeInput.value = 'login';
        title.innerText = "Sign In";
        btn.innerText = "Log In";
        toggleText.innerHTML = 'New here? <a href="#" onclick="toggleAuthMode()">Create Account</a>';
        signupFields.style.display = 'none';
    }
}

// --- UPDATED FORM HANDLER ---
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
        const role = document.getElementById('userRole').value; // 'passenger' or 'volunteer'
        const mode = document.getElementById('authMode').value; // 'login' or 'signup'
        
        // Get extra data if signing up
        const name = document.getElementById('fullName').value;
        const phone = document.getElementById('phone').value;

        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    action: mode, // Sends 'signup' or 'login'
                    email, 
                    password, 
                    role,
                    name: mode === 'signup' ? name : undefined,
                    phone: mode === 'signup' ? phone : undefined
                })
            });
            const data = await response.json();

            if (data.success) {
                isLoggedIn = true;
                currentUserRole = role; // 🔒 LOCK THE SESSION TO THIS ROLE
                
                alert(mode === 'signup' ? "✅ Account Created! Logged in." : "✅ Welcome back!");
                
                // Update Login Button state
                const loginBtn = document.getElementById('authBtn');
                if(loginBtn) {
                    loginBtn.innerHTML = 'Log Out';
                    loginBtn.setAttribute('onclick', 'logout()');
                }
                
                // Route to correct screen
                if (role === 'passenger') showScreen('screen-passenger');
                else { showScreen('screen-volunteer'); loadVolunteerFeed(); }
            } else {
                alert("❌ Error: " + (data.error || "Unknown error"));
            }
        } catch (error) {
            console.error(error);
            alert("⚠️ Connection Error. Logging in offline mode for demo.");
            isLoggedIn = true;
            currentUserRole = role; // Lock offline mode too
            if (role === 'passenger') showScreen('screen-passenger');
            else showScreen('screen-volunteer');
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    });
}

// --- PASSENGER: GPS ---
// --- PASSENGER: GPS (With Address Lookup) ---
function getGPS() {
    const display = document.getElementById('locationDisplay');
    display.value = "Locating...";
    
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                userCoords = { lat: lat, lng: lng };
                
                // ✅ NEW: Convert Coordinates to Address (Reverse Geocoding)
                const geocoder = new google.maps.Geocoder();
                geocoder.geocode({ location: { lat: lat, lng: lng } }, (results, status) => {
                    if (status === "OK" && results[0]) {
                        // Success! Show the actual address (e.g., "123 High St, London")
                        display.value = "📍 " + results[0].formatted_address; 
                    } else {
                        // Fallback: If address lookup fails, show coords
                        console.warn("Geocoder failed: " + status);
                        display.value = `📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}`; 
                    }
                });
            },
            () => { 
                display.value = "❌ GPS Error (Using Default)"; 
                // Default to Central London
                userCoords = { lat: 51.505, lng: -0.09 }; 
            }
        );
    } else {
        display.value = "❌ Not Supported";
    }
}
// --- STEP 1: SEARCH & SHOW ROUTES ---
const reqForm = document.getElementById('requestForm');
if(reqForm) {
    reqForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!userCoords) {
            alert("⚠️ Please click the target button 🎯 to get your location first!");
            return;
        }

        const btn = e.target.querySelector('button');
        const originalText = btn.innerText;
        btn.innerText = 'Calculating Route...';
        btn.disabled = true;
        
        const dest = document.getElementById('destination').value;
        
        try {
            // 1. Hide the Form
            document.getElementById('requestForm').style.display = 'none';
            
            // 2. Show the Map & Confirm Button
            const mapContainer = document.getElementById('map-container'); 
            if(mapContainer) mapContainer.style.display = 'block';

            // 3. Initialize Map & Calculate Routes
            initGoogleMap(userCoords.lat, userCoords.lng, dest);

        } catch (err) {
            console.error("Error:", err);
            alert("⚠️ Could not load map.");
            document.getElementById('requestForm').style.display = 'block';
        } finally {
            btn.innerText = originalText;
            btn.disabled = false;
        }
    });
}

// --- STEP 2: CONFIRM & CONNECT ---
async function confirmSelection() {
    // 1. Show the "Connecting..." Overlay (Bottom Sheet)
    const overlay = document.getElementById('connecting-overlay');
    if(overlay) {
        overlay.style.display = 'block';
        // Scroll to top so user sees the "Connecting" header
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // 2. Update Text Details
    const dest = document.getElementById('destination').value;
    const previewDest = document.getElementById('preview-dest');
    if(previewDest) previewDest.innerText = dest;

    // 3. Save to AWS (Database)
    const email = document.getElementById('email').value || "Guest";
    const type = document.getElementById('helpType').value;

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'request_help', 
                email: email,
                destination: dest,
                helpType: type,
                lat: userCoords.lat,
                lng: userCoords.lng
            })
        });
        const data = await res.json();
        if(data.success) console.log("Request saved to cloud");
    } catch(err) {
        console.error("AWS Save Error:", err);
    }
}

// --- VOLUNTEER FEED ---
async function loadVolunteerFeed() {
    const feed = document.getElementById('requests-feed');
    if(!feed) return;
    feed.innerHTML = `<div class="text-center py-4"><div class="spinner-border text-success"></div><p>Loading...</p></div>`;

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'get_requests' }) 
        });
        const data = await res.json();

        if (data.success && data.requests && data.requests.length > 0) {
            // We use (req.lat, req.lng) to pass the location to the map
            feed.innerHTML = data.requests.map(req => `
                <div class="card mb-3 border-0 shadow-sm">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start">
                            <div>
                                <h5 class="card-title fw-bold text-dark mb-1">Passenger Request</h5>
                                <p class="card-text text-muted small mb-2"><i class="fa-solid fa-map-pin text-danger"></i> ${req.destination}</p>
                            </div>
                            <span class="badge bg-primary">${req.helpType}</span>
                        </div>
                        
                        <div class="d-grid mt-3">
                            <button class="btn btn-success fw-bold" 
                                onclick="acceptRequest(${req.lat}, ${req.lng}, '${req.destination.replace(/'/g, "\\'")}')">
                                Accept & Navigate <i class="fa-solid fa-location-arrow ms-2"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `).join('');
        } else {
            feed.innerHTML = `<p class="text-center text-muted">No active requests found.</p>`;
        }
    } catch (err) {
        console.error(err);
        feed.innerHTML = `<p class="text-center text-danger">Could not connect to Cloud.</p>`;
    }
}

// --- VOLUNTEER: ACCEPT & NAVIGATE ---
function acceptRequest(passengerLat, passengerLng, destName) {
    // 1. Switch UI: Hide Feed, Show Map
    document.getElementById('requests-feed').style.display = 'none';
    document.getElementById('volunteer-nav').style.display = 'block';
    
    // Update the status text
    const statusText = document.getElementById('nav-dest');
    if(statusText) statusText.innerText = "Heading to: " + destName;

    // 2. Get Volunteer's Current Location
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((position) => {
            const volLat = position.coords.latitude;
            const volLng = position.coords.longitude;

            // 3. Initialize the Volunteer Map
            const mapDiv = document.getElementById('volunteer-map');
            const volMap = new google.maps.Map(mapDiv, {
                zoom: 15,
                center: { lat: volLat, lng: volLng },
                disableDefaultUI: true // Cleaner look for navigation
            });

            const dirService = new google.maps.DirectionsService();
            const dirRenderer = new google.maps.DirectionsRenderer({
                map: volMap,
                suppressMarkers: false
            });

            // 4. Calculate Walking Route (Volunteer -> Passenger)
            const request = {
                origin: { lat: volLat, lng: volLng },     // Volunteer is here
                destination: { lat: passengerLat, lng: passengerLng }, // Passenger is here
                travelMode: 'WALKING'
            };

            dirService.route(request, (result, status) => {
                if (status === 'OK') {
                    dirRenderer.setDirections(result);
                } else {
                    alert("⚠️ Could not calculate route: " + status);
                }
            });

        }, () => {
            alert("❌ GPS Error. Could not find your location.");
        });
    } else {
        alert("❌ Geolocation is not supported by this browser.");
    }
}

// --- VOLUNTEER: COMPLETE JOB ---
function completeJob() {
    // Reset UI
    document.getElementById('volunteer-nav').style.display = 'none';
    document.getElementById('requests-feed').style.display = 'block';
    
    // Optional: You could send a "Complete" signal to the database here if you wanted
    alert("✅ Job Complete! Thank you for your help.");
    
    // Refresh the list to see if there are new jobs
    loadVolunteerFeed();
}
// --- GOOGLE MAPS LOGIC (With Route Options) ---
function initGoogleMap(userLat, userLng, destinationText) {
    const mapContainer = document.getElementById('google-map');
    const panelContainer = document.getElementById('directions-panel'); 

    // 1. Initialize Map
    if (!map) {
        try {
            map = new google.maps.Map(mapContainer, {
                zoom: 14,
                center: { lat: userLat, lng: userLng },
                mapTypeControl: false, 
                fullscreenControl: false,
                streetViewControl: false
            });
            directionsService = new google.maps.DirectionsService();
            directionsRenderer = new google.maps.DirectionsRenderer();
            
            // Link Map & Panel
            directionsRenderer.setMap(map);
            directionsRenderer.setPanel(panelContainer); 

        } catch(e) {
            alert("⚠️ Map Error. Check API Key.");
            return;
        }
    }

    // 2. Request Route (WITH ALTERNATIVES)
    const request = {
        origin: { lat: userLat, lng: userLng },
        destination: destinationText, 
        travelMode: 'TRANSIT', 
        provideRouteAlternatives: true, // ✅ Shows multiple options
        transitOptions: {
            modes: ['SUBWAY', 'TRAIN', 'BUS'], 
            routingPreference: 'FEWER_TRANSFERS'
        }
    };

    directionsService.route(request, function(result, status) {
        if (status == 'OK') {
            directionsRenderer.setDirections(result);
        } else {
            console.error("Maps Error:", status);
            if (status === 'ZERO_RESULTS') {
                alert('⚠️ No public transport route found. Switching to walking.');
                request.travelMode = 'WALKING';
                request.provideRouteAlternatives = false; 
                directionsService.route(request, (res, stat) => {
                    if (stat === 'OK') directionsRenderer.setDirections(res);
                });
            } else {
                alert('❌ Route Failed: ' + status);
            }
        }
    });
}

// --- CANCEL & RESET ---
function cancelRequest() {
    // Hide overlay
    const overlay = document.getElementById('connecting-overlay');
    if(overlay) overlay.style.display = 'none';

    // Hide Map Container
    const mapContainer = document.getElementById('map-container');
    if(mapContainer) mapContainer.style.display = 'none';

    // Show form again
    const form = document.getElementById('requestForm');
    if(form) form.style.display = 'block';

    alert("Request cancelled.");
}

// --- ENABLE AUTOCOMPLETE ---
window.onload = function() {
    const destInput = document.getElementById('destination');
    if (destInput && google) {
        new google.maps.places.Autocomplete(destInput);
    }
};