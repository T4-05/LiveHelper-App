// ✅ CONNECTED TO YOUR AWS CLOUD
const API_URL = 'https://adspkvmkg1.execute-api.us-east-1.amazonaws.com/default/LiveHelper-Login';
let isLoggedIn = false;
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

function handleActionClick(role) {
    if (isLoggedIn) {
        if (role === 'passenger') showScreen('screen-passenger');
        else { showScreen('screen-volunteer'); loadVolunteerFeed(); }
    } else {
        showScreen('screen-login');
        switchLoginTab(role);
    }
}

function checkLogin(role) { handleActionClick(role); }
function goToLogin() { showScreen('screen-login'); }

function logout() {
    isLoggedIn = false;
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
        const role = document.getElementById('userRole').value;
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
                alert(mode === 'signup' ? "✅ Account Created! Logged in." : "✅ Welcome back!");
                
                // Update Login Button state
                const loginBtn = document.getElementById('authBtn');
                if(loginBtn) {
                    loginBtn.innerHTML = 'Log Out';
                    loginBtn.setAttribute('onclick', 'logout()');
                }
                
                if (role === 'passenger') showScreen('screen-passenger');
                else { showScreen('screen-volunteer'); loadVolunteerFeed(); }
            } else {
                alert("❌ Error: " + (data.error || "Unknown error"));
            }
        } catch (error) {
            console.error(error);
            alert("⚠️ Connection Error. Logging in offline mode for demo.");
            isLoggedIn = true;
            if (role === 'passenger') showScreen('screen-passenger');
            else showScreen('screen-volunteer');
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    });
}

// --- PASSENGER: GPS ---
function getGPS() {
    const display = document.getElementById('locationDisplay');
    display.value = "Locating...";
    
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                userCoords = { lat: lat, lng: lng };
                display.value = `📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
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
            
            // 2. Show the Map & Confirm Button (BUT NOT THE OVERLAY YET)
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
            feed.innerHTML = data.requests.map(req => `
                <div class="card mb-3 border-0 shadow-sm">
                    <div class="card-body">
                        <h5 class="card-title fw-bold">${req.passengerEmail || 'Passenger'}</h5>
                        <p class="card-text">To: <strong>${req.destination}</strong></p>
                        <span class="badge bg-info text-dark">${req.helpType}</span>
                        <button class="btn btn-success w-100 mt-2" onclick="alert('Accepted!')">Accept</button>
                    </div>
                </div>
            `).join('');
        } else {
            feed.innerHTML = `<p class="text-center text-muted">No active requests found.</p>`;
        }
    } catch (err) {
        feed.innerHTML = `<p class="text-center text-danger">Could not connect to Cloud.</p>`;
    }
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