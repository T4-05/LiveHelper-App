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

const authForm = document.getElementById('authForm');
if(authForm) {
    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;
        btn.innerHTML = 'Connecting...';
        btn.disabled = true;

        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const role = document.getElementById('userRole').value;

        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'login', email, password, role })
            });
            const data = await response.json();

            if (data.success) {
                isLoggedIn = true;
                alert(`✅ Login Successful!`);
                const loginBtn = document.getElementById('authBtn');
                if(loginBtn) {
                    loginBtn.innerHTML = 'Log Out';
                    loginBtn.setAttribute('onclick', 'logout()');
                }
                if (role === 'passenger') showScreen('screen-passenger');
                else { showScreen('screen-volunteer'); loadVolunteerFeed(); }
            } else {
                alert("❌ Login Failed: " + (data.error || "Unknown error"));
            }
        } catch (error) {
            console.error(error);
            alert("⚠️ Cloud Connection Error. Logging you in offline mode.");
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

const reqForm = document.getElementById('requestForm');
if(reqForm) {
    reqForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // 1. Check if we have a location
        if (!userCoords) {
            alert("⚠️ Please click the target button 🎯 to get your location first!");
            return;
        }

        const btn = e.target.querySelector('button');
        const originalText = btn.innerText;
        btn.innerText = 'Calculating Route...';
        btn.disabled = true;
        
        const dest = document.getElementById('destination').value;
        const type = document.getElementById('helpType').value;
        const email = document.getElementById('email').value || "Guest";
        
        try {
            // Save to AWS
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

        } catch (err) {
            console.error("AWS Error (Ignored for Map):", err);
        } finally {
            btn.innerText = originalText;
            btn.disabled = false;
            
            // Initialize Map with real coordinates
            initGoogleMap(userCoords.lat, userCoords.lng, dest);
        }
    });
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

// --- GOOGLE MAPS LOGIC ---
function initGoogleMap(userLat, userLng, destinationText) {
    const mapContainer = document.getElementById('google-map');
    mapContainer.style.display = 'block';

    if (!map) {
        try {
            map = new google.maps.Map(mapContainer, {
                zoom: 14,
                center: { lat: userLat, lng: userLng }
            });
            directionsService = new google.maps.DirectionsService();
            directionsRenderer = new google.maps.DirectionsRenderer();
            directionsRenderer.setMap(map);
        } catch(e) {
            alert("⚠️ Map Error. Check API Key.");
            return;
        }
    }

    const request = {
        origin: { lat: userLat, lng: userLng },
        destination: destinationText, 
        travelMode: 'WALKING'
    };

    directionsService.route(request, function(result, status) {
        if (status == 'OK') {
            directionsRenderer.setDirections(result);
        } else {
            // Detailed error for debugging
            console.error("Maps Error:", status);
            alert('❌ Route Failed: Could not find a path to that destination.');
        }
    });
}

// --- ✅ ENABLE GOOGLE AUTOCOMPLETE ---
// This ensures the page is ready before attaching the tool
window.onload = function() {
    const destInput = document.getElementById('destination');
    if (destInput && google) {
        new google.maps.places.Autocomplete(destInput);
    }
};