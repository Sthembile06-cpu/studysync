function setGreeting() {
    const hour = new Date().getHours();
    let greeting = '';

    if (hour >= 5 && hour < 12) {
        greeting = 'Good morning 🌅';
    } else if (hour >= 12 && hour < 17) {
        greeting = 'Good afternoon ☀️';
    } else if (hour >= 17 && hour < 21) {
        greeting = 'Good evening 🌆';
    } else {
        greeting = 'studying late? 🌙';
    }

    document.getElementById('welcome-name').textContent = greeting;
}

setGreeting();