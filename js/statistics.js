async function loadStatistics() {
    const token = localStorage.getItem('token');

    try {
        const response = await fetch('https://studysync-backend-we5u.onrender.com/api/sessions', {
            headers: { 'Authorization': 'Bearer ' + token }
        });

        const sessions = await response.json();

        // calculate stats
        const totalSessions = sessions.length;
        const totalMinutes = sessions.reduce((sum, s) => sum + (s.study_minutes * s.cycles), 0);
        const totalHours = (totalMinutes / 60).toFixed(1);
        const streak = parseInt(localStorage.getItem('streak')) || 0;

        // update stat boxes
        document.getElementById('total-hours').textContent = totalHours + 'h';
        document.getElementById('total-sessions').textContent = totalSessions;
        document.getElementById('current-streak').textContent = streak;
        document.getElementById('longest-streak').textContent = streak;

        loadWeeklyChart(sessions);
        loadInsights(sessions);

    } catch (error) {
        console.error('Failed to load statistics:', error);
    }
}

function loadWeeklyChart(sessions) {
    const now = new Date();
    const weekData = [0, 0, 0, 0, 0, 0, 0];

    sessions.forEach(session => {
        const date = new Date(session.completed_at);
        const dayDiff = Math.floor((now - date) / (1000 * 60 * 60 * 24));

        if (dayDiff < 7) {
            let dayIndex = date.getDay() - 1;
            if (dayIndex < 0) dayIndex = 6;
            weekData[dayIndex] += session.study_minutes;
        }
    });

    const maxMinutes = Math.max(...weekData, 1);
    const bars = document.querySelectorAll('.week-bar');

    bars.forEach((bar, index) => {
        if (weekData[index] > 0) {
            const height = (weekData[index] / maxMinutes) * 100;
            bar.style.height = height + '%';
            bar.title = weekData[index] + ' min studied';
            bar.style.opacity = '1';
        } else {
            bar.style.height = '4px';
            bar.style.opacity = '0.2';
        }
    });
}

function loadInsights(sessions) {
    if (sessions.length === 0) return;

    // best study day
    const dayCounts = [0, 0, 0, 0, 0, 0, 0];
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    sessions.forEach(session => {
        const date = new Date(session.completed_at);
        dayCounts[date.getDay()]++;
    });

    const bestDayIndex = dayCounts.indexOf(Math.max(...dayCounts));
    document.getElementById('best-day').textContent = dayNames[bestDayIndex];

    // average session length
    const totalMinutes = sessions.reduce((sum, s) => sum + s.study_minutes, 0);
    const avg = Math.round(totalMinutes / sessions.length);
    document.getElementById('avg-session').textContent = avg + ' min';

    // favourite sound
    const soundCounts = {};
    sessions.forEach(session => {
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
    sessions.forEach(session => {
        const date = new Date(session.completed_at);
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