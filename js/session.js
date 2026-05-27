// make all duration buttons selectable
document.querySelectorAll('.dashboard-card').forEach(card => {
    card.querySelectorAll('.duration-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            card.querySelectorAll('.duration-btn').forEach(b => b.classList.remove('active-duration'));
            this.classList.add('active-duration');
        });
    });
});

// show custom input when Custom button is clicked
document.querySelector('#study-duration .duration-btn:last-child').addEventListener('click', function() {
    document.getElementById('custom-study').style.display = 'block';
});

document.querySelector('#break-duration .duration-btn:last-child').addEventListener('click', function() {
    document.getElementById('custom-break').style.display = 'block';
});

// hide custom input when other buttons are clicked
document.querySelectorAll('#study-duration .duration-btn:not(:last-child)').forEach(btn => {
    btn.addEventListener('click', function() {
        document.getElementById('custom-study').style.display = 'none';
        document.getElementById('custom-study-input').value = '';
    });
});

document.querySelectorAll('#break-duration .duration-btn:not(:last-child)').forEach(btn => {
    btn.addEventListener('click', function() {
        document.getElementById('custom-break').style.display = 'none';
        document.getElementById('custom-break-input').value = '';
    });
});

// start session button
document.getElementById('start-session-btn').addEventListener('click', function() {
    const studyBtn = document.querySelector('#study-duration .active-duration');
    const breakBtn = document.querySelector('#break-duration .active-duration');
    const cyclesBtn = document.querySelector('#cycles .active-duration');
    const soundBtn = document.querySelector('#ambient-sound .active-duration');

    const customStudy = document.getElementById('custom-study-input').value;
    const customBreak = document.getElementById('custom-break-input').value;

    const studyTime = customStudy ? customStudy + ' min' : (studyBtn ? studyBtn.textContent : '25 min');
    const breakTime = customBreak ? customBreak + ' min' : (breakBtn ? breakBtn.textContent : '5 min');
    const cycles = cyclesBtn ? cyclesBtn.textContent.trim() : '1';
    const sound = soundBtn ? soundBtn.textContent.trim() : '🔇 None';

    localStorage.setItem('studyTime', studyTime);
    localStorage.setItem('breakTime', breakTime);
    localStorage.setItem('cycles', cycles);
    localStorage.setItem('sound', sound);

    window.location.href = 'focus.html';
});