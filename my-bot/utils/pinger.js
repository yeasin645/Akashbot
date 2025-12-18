const axios = require('axios');
const cron = require('node-cron');

function startPinger(url) {
    if (!url) return console.log("⚠️ APP_URL missing, pinger not started.");
    cron.schedule('*/5 * * * *', async () => {
        try {
            await axios.get(url);
            console.log('✅ Keep-alive ping sent.');
        } catch (e) {
            console.log('❌ Ping failed.');
        }
    });
}
module.exports = startPinger;
