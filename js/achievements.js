function unlockAchievement(id) {
    const item = document.getElementById(id);
    if (item) {
        item.classList.remove('locked');
        item.style.border = '1px solid #378ADD';
    }
    localStorage.setItem('achievement-' + id, 'unlocked');
}

function checkAchievements() {
    const sessions = parseInt(localStorage.getItem('totalSessions')) || 0;
    const hours = parseFloat(localStorage.getItem('totalHours')) || 0;
    const streak = parseInt(localStorage.getItem('streak')) || 0;
    const hour = new Date().getHours();

    if (sessions >= 1) unlockAchievement('first-spark');
    if (sessions >= 50) unlockAchievement('50-sessions');
    if (hours >= 10) unlockAchievement('10-hours');
    if (hours >= 100) unlockAchievement('100-hours');
    if (streak >= 7) unlockAchievement('7-day-streak');
    if (streak >= 30) unlockAchievement('30-day-streak');
    if (hour >= 22) unlockAchievement('night-owl');
    if (hour < 7) unlockAchievement('early-bird');

    // check deep focus — 2 hour session
    const deepFocus = localStorage.getItem('deepFocus');
    if (deepFocus === 'true') unlockAchievement('deep-focus');

    // check marathon — 5 hours in one day
    const todayHours = parseFloat(localStorage.getItem('todayHours')) || 0;
    if (todayHours >= 5) unlockAchievement('marathon');
}

function loadSavedAchievements() {
    const ids = ['first-spark', '7-day-streak', '10-hours', 'night-owl',
                 'early-bird', '50-sessions', '30-day-streak', '100-hours',
                 'deep-focus', 'marathon'];

    ids.forEach(id => {
        if (localStorage.getItem('achievement-' + id) === 'unlocked') {
            unlockAchievement(id);
        }
    });
}

function updateProgressBar() {
    const ids = ['first-spark', '7-day-streak', '10-hours', 'night-owl',
                 'early-bird', '50-sessions', '30-day-streak', '100-hours',
                 'deep-focus', 'marathon'];

    const unlocked = ids.filter(id => 
        localStorage.getItem('achievement-' + id) === 'unlocked'
    ).length;

    document.getElementById('achievements-count').textContent = 
        unlocked + ' / 10 unlocked';
    document.getElementById('achievement-bar-fill').style.width = 
        (unlocked / 10 * 100) + '%';
}

// run on page load
loadSavedAchievements();
checkAchievements();
updateProgressBar();