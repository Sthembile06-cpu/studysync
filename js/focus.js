// quotes list
const quotes = [
    "The secret of getting ahead is getting started. — Mark Twain",
    "Focus on being productive instead of busy. — Tim Ferriss",
    "It always seems impossible until it's done. — Nelson Mandela",
    "Small progress is still progress.",
    "You don't have to be great to start, but you have to start to be great.",
    "Discipline is choosing between what you want now and what you want most.",
    "The future depends on what you do today. — Mahatma Gandhi",
    "Don't watch the clock. Do what it does — keep going. — Sam Levenson"
];

// prevent screen from sleeping
let wakeLock = null;

async function requestWakeLock() {
    try {
        wakeLock = await navigator.wakeLock.request('screen');
        console.log('Wake lock active');
    } catch (error) {
        console.log('Wake lock error:', error);
    }
}

async function releaseWakeLock() {
    if (wakeLock) {
        await wakeLock.release();
        wakeLock = null;
        console.log('Wake lock released');
    }
}

// unlock audio on first user interaction
let audioUnlocked = false;

function unlockAudio() {
    if (!audioUnlocked) {
        const silentAudio = new Audio('../assets/sounds/alarm.mp3');
        silentAudio.volume = 0;
        silentAudio.play().then(() => {
            silentAudio.pause();
            audioUnlocked = true;
        }).catch(() => {});
    }
}

document.addEventListener('click', unlockAudio, { once: false });

// read settings from localStorage
const studyTime = localStorage.getItem('studyTime') || '25 min';
const breakTime = localStorage.getItem('breakTime') || '5 min';
const totalCycles = parseInt(localStorage.getItem('cycles')) || 1;
const sound = localStorage.getItem('sound') || '🔇 None';

// parse minutes from string like "25 min"
const studyMinutes = parseInt(studyTime) || 25;
const breakMinutes = parseInt(breakTime) || 5;

// state
let currentCycle = 1;
let isStudying = true;
let timeLeft = studyMinutes * 60;
let totalTime = studyMinutes * 60;
let isPaused = false;
let timerInterval = null;

// audio
const sounds = {
    'rain': '../assets/sounds/rain.mp3',
    'library': '../assets/sounds/library.mp3',
    'white': '../assets/sounds/whitenoise.mp3',
    'lofi': '../assets/sounds/lofi.mp3'
};

let audio = null;

function playSound() {
    const soundLower = sound.toLowerCase();
    let soundFile = null;

    if (soundLower.includes('rain')) soundFile = sounds.rain;
    else if (soundLower.includes('library')) soundFile = sounds.library;
    else if (soundLower.includes('white')) soundFile = sounds.white;
    else if (soundLower.includes('lo-fi') || soundLower.includes('lofi')) soundFile = sounds.lofi;

    if (soundFile) {
        audio = new Audio(soundFile);
        audio.loop = true;
        audio.volume = 0.5;
        audio.play();
        document.getElementById('sound-indicator').textContent = sound + ' playing';
    } else {
        document.getElementById('sound-indicator').textContent = '🔇 No sound';
    }
}

function stopSound() {
    if (audio) {
        audio.pause();
        audio.currentTime = 0;
    }
}

// set random quote
function setQuote() {
    const random = Math.floor(Math.random() * quotes.length);
    document.getElementById('focus-quote').textContent = '"' + quotes[random] + '"';
}

// format time as MM:SS
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
}

// update progress bar
function updateProgress() {
    const percent = ((totalTime - timeLeft) / totalTime) * 100;
    document.getElementById('progress-fill').style.width = percent + '%';
}

// update cycle display
function updateCycleDisplay() {
    document.querySelector('.focus-cycle').textContent = 'Cycle ' + currentCycle + ' of ' + totalCycles;
}

// alarm sound
function playAlarm() {
    const alarmSound = new Audio('../assets/sounds/alarm.mp3');
    alarmSound.volume = 1.0;
    alarmSound.play().catch(function(error) {
        console.log('Alarm error:', error);
    });
}

function switchMode() {
    playAlarm();

    if (isStudying) {
        isStudying = false;
        timeLeft = breakMinutes * 60;
        totalTime = breakMinutes * 60;

        document.getElementById('focus-mode-label').textContent = 'BREAK TIME ☕';
        document.body.style.background = '#0a1a0a';
        document.querySelector('.focus-timer-ring').style.borderTopColor = '#C9922A';
        document.querySelector('.focus-progress-fill').style.background = '#C9922A';
        document.getElementById('focus-quote').textContent = '"Take a deep breath. You earned this break."';

        stopSound();

    } else {
        currentCycle++;

        if (currentCycle > totalCycles) {
            endSession();
            return;
        }

        isStudying = true;
        timeLeft = studyMinutes * 60;
        totalTime = studyMinutes * 60;

        document.getElementById('focus-mode-label').textContent = 'FOCUS SESSION';
        document.body.style.background = '#0a0f1e';
        document.querySelector('.focus-timer-ring').style.borderTopColor = '#378ADD';
        document.querySelector('.focus-progress-fill').style.background = '#378ADD';

        playSound();
        setQuote();
        updateCycleDisplay();
    }
}

// end session
function endSession() {
    clearInterval(timerInterval);
    stopSound();
    releaseWakeLock();
    alert('Session complete! Well done! 🎉');
    window.location.href = 'dashboard.html';
}

// main timer tick
function tick() {
    timeLeft--;

    if (timeLeft <= 0) {
        clearInterval(timerInterval);
        timeLeft = 0;
        document.getElementById('timer-display').textContent = formatTime(timeLeft);
        updateProgress();
        switchMode();
        if (!isPaused) startTimer();
        return;
    }

    document.getElementById('timer-display').textContent = formatTime(timeLeft);
    updateProgress();
}

// start timer
function startTimer() {
    timerInterval = setInterval(tick, 1000);
}

// pause button
document.getElementById('pause-btn').addEventListener('click', function() {
    if (isPaused) {
        isPaused = false;
        startTimer();
        this.textContent = '⏸ Pause';
        if (isStudying) playSound();
    } else {
        isPaused = true;
        clearInterval(timerInterval);
        this.textContent = '▶ Resume';
        stopSound();
    }
});

// skip button
document.getElementById('skip-btn').addEventListener('click', function() {
    clearInterval(timerInterval);
    switchMode();
    if (!isPaused) startTimer();
});

// end button
document.getElementById('end-btn').addEventListener('click', function() {
    if (confirm('Are you sure you want to end the session?')) {
        endSession();
    }
});

// exit button
document.querySelector('.focus-exit-btn').addEventListener('click', function() {
    if (confirm('Are you sure you want to exit?')) {
        stopSound();
        releaseWakeLock();
        window.location.href = 'session.html';
    }
});

// initialise
setQuote();
updateCycleDisplay();
document.getElementById('timer-display').textContent = formatTime(timeLeft);
playSound();
startTimer();
requestWakeLock();