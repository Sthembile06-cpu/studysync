function loadProfile() {
    const name = localStorage.getItem('profileName') || 'Student';
    const email = localStorage.getItem('profileEmail') || 'No email set';
    const goal = localStorage.getItem('studyGoal') || '2';
    const sessions = parseInt(localStorage.getItem('totalSessions')) || 0;
    const hours = parseFloat(localStorage.getItem('totalHours')) || 0;
    const streak = parseInt(localStorage.getItem('streak')) || 0;

    document.getElementById('profile-name').textContent = name;
    document.getElementById('profile-email').textContent = email;
    document.getElementById('profile-avatar').textContent = name.charAt(0).toUpperCase();
    document.getElementById('edit-name').value = name !== 'Student' ? name : '';
    document.getElementById('edit-email').value = email !== 'No email set' ? email : '';
    document.getElementById('study-goal').value = goal;
    document.getElementById('profile-sessions').textContent = sessions;
    document.getElementById('profile-hours').textContent = hours + 'h';
    document.getElementById('profile-streak').textContent = streak;

    loadProfileAchievements();
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

document.getElementById('save-profile-btn').addEventListener('click', function() {
    const name = document.getElementById('edit-name').value.trim();
    const email = document.getElementById('edit-email').value.trim();
    const goal = document.getElementById('study-goal').value;

    if (name) localStorage.setItem('profileName', name);
    if (email) localStorage.setItem('profileEmail', email);
    localStorage.setItem('studyGoal', goal);

    loadProfile();
    alert('Profile saved!');
});

document.getElementById('logout-btn').addEventListener('click', function() {
    if (confirm('Are you sure you want to log out?')) {
        window.location.href = 'login.html';
    }
});

loadProfile();