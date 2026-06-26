// load saved settings
function loadSettings() {
    const alarmOn = localStorage.getItem('alarmOn') !== 'false';
    const breakOn = localStorage.getItem('breakOn') !== 'false';
    const reminderOn = localStorage.getItem('reminderOn') === 'true';
    const defaultStudy = localStorage.getItem('defaultStudy') || '25';
    const defaultBreak = localStorage.getItem('defaultBreak') || '5';
    const defaultSound = localStorage.getItem('defaultSound') || 'rain';

    document.getElementById('alarm-toggle').checked = alarmOn;
    document.getElementById('break-toggle').checked = breakOn;
    document.getElementById('reminder-toggle').checked = reminderOn;
    document.getElementById('default-study').value = defaultStudy;
    document.getElementById('default-break').value = defaultBreak;
    document.getElementById('default-sound').value = defaultSound;
}

// save settings
document.getElementById('save-settings-btn').addEventListener('click', function() {
    localStorage.setItem('alarmOn', document.getElementById('alarm-toggle').checked);
    localStorage.setItem('breakOn', document.getElementById('break-toggle').checked);
    localStorage.setItem('reminderOn', document.getElementById('reminder-toggle').checked);
    localStorage.setItem('defaultStudy', document.getElementById('default-study').value);
    localStorage.setItem('defaultBreak', document.getElementById('default-break').value);
    localStorage.setItem('defaultSound', document.getElementById('default-sound').value);

    alert('Settings saved!');
});

// clear all data
document.getElementById('clear-data-btn').addEventListener('click', async function() {
    if (!confirm('Are you sure? This will permanently delete all your stats, history and achievements. This cannot be undone.')) {
        return;
    }

    const token = localStorage.getItem('token');

    try {
        const response = await fetch('https://studysync-backend-we5u.onrender.com/api/sessions', {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + token }
        });

        if (!response.ok) {
            throw new Error('Failed to delete sessions from server');
        }

        // clear local copies (achievements, old session history, streak, preferences)
        localStorage.removeItem('sessionHistory');
        localStorage.removeItem('totalSessions');
        localStorage.removeItem('totalHours');
        localStorage.removeItem('todayHours');
        localStorage.removeItem('streak');
        localStorage.removeItem('lastStudyDate');
        localStorage.removeItem('deepFocus');

        // clear achievement flags
        const achievementIds = [
            'first-spark', '7-day-streak', '10-hours', 'night-owl', 'early-bird',
            '50-sessions', '30-day-streak', '100-hours', 'deep-focus', 'marathon'
        ];
        achievementIds.forEach(id => localStorage.removeItem('achievement-' + id));

        alert('All your data has been cleared.');
        window.location.href = 'dashboard.html';

    } catch (error) {
        console.error('Clear data error:', error);
        alert('Something went wrong while clearing your data. Please try again.');
    }
});

loadSettings();