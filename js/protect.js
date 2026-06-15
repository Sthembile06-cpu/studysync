console.log('protect.js loaded');

// check if user is logged in
function checkAuth() {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user'));

    console.log('token:', token);
    console.log('user:', user);

    if (!token || !user) {
        window.location.href = 'login.html';
        return;
    }

    // update greeting with real name
    const hour = new Date().getHours();
    let greeting = '';
    if (hour >= 5 && hour < 12) greeting = 'Good morning';
    else if (hour >= 12 && hour < 17) greeting = 'Good afternoon';
    else if (hour >= 17 && hour < 21) greeting = 'Good evening';
    else greeting = 'Studying late?';

    const welcomeEl = document.getElementById('welcome-name');
    if (welcomeEl && user) {
        welcomeEl.textContent = greeting + ', ' + user.name + ' 👋';
    }
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = 'login.html';
}

checkAuth();