function loadStatistics() {
    const sessions = parseInt(localStorage.getItem('totalSessions')) || 0;
    const hours = parseFloat(localStorage.getItem('totalHours')) || 0;
    const streak = parseInt(localStorage.getItem('streak')) || 0;
    const history = JSON.parse(localStorage.getItem('sessionHistory')) || [];

    // update stat boxes
    document.getElementById('total-hours').textContent = hours + 'h';
    document.getElementById('total-sessions').textContent = sessions;
    document.getElementById('current-streak').textContent = streak;
    document.getElementById('longest-streak').textContent = streak;

    loadWeeklyChart(history);
    loadInsights(history);
}

function loadWeeklyChart(history) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const now = new Date();
    const weekData = [0, 0, 0, 0, 0, 0, 0];

    history.forEach(session => {
        const date = new Date(session.date);
        const dayDiff = Math.floor((now - date) / (1000 * 60 * 60 * 24));

        if (dayDiff < 7) {
            let dayIndex = date.getDay() - 1;
            if (dayIndex < 0) dayIndex = 6;
            const minutes = parseInt(session.study) || 0;
            weekData[dayIndex] += minutes;
        }
    });

    const maxMinutes = Math.max(...weekData, 1);
    const bars = document.querySelectorAll('.week-bar');

    bars.forEach((bar, index) => {
        const height = (weekData[index] / maxMinutes) * 100;
        bar.style.height = height + '%';
        bar.title = weekData[index] + ' min';
    });
}

function loadInsights(history) {
    if (history.length === 0) return;

    // best study day
    const dayCounts = [0, 0, 0, 0, 0, 0, 0];
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    history.forEach(session => {
        const date = new Date(session.date);
        dayCounts[date.getDay()]++;
    });

    const bestDayIndex = dayCounts.indexOf(Math.max(...dayCounts));
    document.getElementById('best-day').textContent = dayNames[bestDayIndex];

    // average session length
    const totalMinutes = history.reduce((sum, s) => sum + (parseInt(s.study) || 0), 0);
    const avg = Math.round(totalMinutes / history.length);
    document.getElementById('avg-session').textContent = avg + ' min';

    // favourite sound
    const soundCounts = {};
    history.forEach(session => {
        if (session.sound) {
            soundCounts[session.sound] = (soundCounts[session.sound] || 0) + 1;
        }
    });

    const favSound = Object.keys(soundCounts).length > 0
        ? Object.keys(soundCounts).reduce((a, b) => soundCounts[a] > soundCounts[b] ? a : b)
        : 'No data yet';

    document.getElementById('fav-sound').textContent = favSound;

    // most productive time
    const hourCounts = {};
    history.forEach(session => {
        const date = new Date(session.date);
        const hour = date.getHours();
        let timeLabel = '';
        if (hour >= 5 && hour < 12) timeLabel = 'Morning';
        else if (hour >= 12 && hour < 17) timeLabel = 'Afternoon';
        else if (hour >= 17 && hour < 21) timeLabel = 'Evening';
        else timeLabel = 'Night';
        hourCounts[timeLabel] = (hourCounts[timeLabel] || 0) + 1;
    });

    const productiveTime = Object.keys(hourCounts).length > 0
        ? Object.keys(hourCounts).reduce((a, b) => hourCounts[a] > hourCounts[b] ? a : b)
        : 'No data yet';

    document.getElementById('productive-time').textContent = productiveTime;
}

loadStatistics();