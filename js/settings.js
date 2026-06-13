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
document.getElementById('clear-data-btn').addEventListener('click', function() {
    if (confirm('Are you sure? This will delete all your stats, history and achievements.')) {
        localStorage.clear();
        alert('All data cleared!');
        window.location.href = 'dashboard.html';
    }
});

loadSettings();