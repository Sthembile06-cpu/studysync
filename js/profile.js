async function loadProfile() {
    const token = localStorage.getItem('token');
    const localUser = JSON.parse(localStorage.getItem('user'));

    try {
        const response = await fetch('http://localhost:5000/api/users/profile', {
            headers: { 'Authorization': 'Bearer ' + token }
        });

        const user = await response.json();

        document.getElementById('profile-name').textContent = user.name;
        document.getElementById('profile-email').textContent = user.email;
        document.getElementById('profile-avatar').textContent = user.name.charAt(0).toUpperCase();
        document.getElementById('edit-name').value = user.name;
        document.getElementById('edit-email').value = user.email;

        // load stats from sessions
        const sessionsResponse = await fetch('http://localhost:5000/api/sessions/stats', {
            headers: { 'Authorization': 'Bearer ' + token }
        });

        const stats = await sessionsResponse.json();
        const totalMinutes = stats.total_minutes || 0;
        const totalSessions = stats.total_sessions || 0;
        const streak = parseInt(localStorage.getItem('streak')) || 0;

        document.getElementById('profile-sessions').textContent = totalSessions;
        document.getElementById('profile-hours').textContent = totalMinutes < 60
            ? totalMinutes + 'm'
            : (totalMinutes / 60).toFixed(1) + 'h';
        document.getElementById('profile-streak').textContent = streak;

        // member since
        const memberSince = new Date(user.created_at).getFullYear();
        document.querySelector('.profile-member').textContent = 'Member since ' + memberSince;

        loadProfileAchievements();

    } catch (error) {
        console.error('Failed to load profile:', error);
    }
}

function loadProfileAchievements() {
    const ids = [
        { id: 'first-spark', icon: '🔥', name: 'First spark' },
        { id: '7-day-streak', icon: '📅', name: '7-day streak' },
        { id: '10-hours', icon: '⏰', name: '10 hours' },
        { id: 'night-owl', icon: '🌙', name: 'Night owl' },
        { id: 'early-bird', icon: '🌅', name: 'Early bird' },
        { id: '50-sessions', icon: '🏆', name: '50 sessions' },
        { id: '30-day-streak', icon: '💪', name: '30-day streak' },
        { id: '100-hours', icon: '📚', name: '100 hours' },
        { id: 'deep-focus', icon: '🎯', name: 'Deep focus' },
        { id: 'marathon', icon: '🌍', name: 'Marathon' }
    ];

    const unlocked = ids.filter(a => 
        localStorage.getItem('achievement-' + a.id) === 'unlocked'
    );

    const container = document.getElementById('profile-achievements');

    if (unlocked.length === 0) {
        container.innerHTML = '<p class="section-subtext">No achievements yet. Complete sessions to earn badges!</p>';
        return;
    }

    container.innerHTML = unlocked.map(a => `
        <div class="profile-badge">
            <span>${a.icon}</span>
            <span>${a.name}</span>
        </div>
    `).join('');
}

document.getElementById('save-profile-btn').addEventListener('click', async function() {
    const token = localStorage.getItem('token');
    const name = document.getElementById('edit-name').value.trim();

    if (!name) {
        alert('Name cannot be empty');
        return;
    }

    try {
        const response = await fetch('http://localhost:5000/api/users/profile', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ name })
        });

        if (response.ok) {
            // update localStorage user
            const user = JSON.parse(localStorage.getItem('user'));
            user.name = name;
            localStorage.setItem('user', JSON.stringify(user));
            loadProfile();
            alert('Profile saved!');
        }

    } catch (error) {
        console.error('Failed to save profile:', error);
        alert('Failed to save profile');
    }
});

document.getElementById('logout-btn').addEventListener('click', function() {
    if (confirm('Are you sure you want to log out?')) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = 'login.html';
    }
});

loadProfile();