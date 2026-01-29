/**
 * Firebase Configuration for FeelLove Dashboard
 *
 * SETUP INSTRUCTIONS:
 * 1. Go to https://console.firebase.google.com/
 * 2. Click "Create a project" (name it "feellove-dashboard" or similar)
 * 3. Once created, click the gear icon > Project settings
 * 4. Scroll down to "Your apps" and click the </> (Web) icon
 * 5. Register your app (nickname: "dashboard")
 * 6. Copy the firebaseConfig values below
 * 7. In the Firebase console, go to "Build" > "Realtime Database"
 * 8. Click "Create Database", choose your region, start in "test mode"
 * 9. Update the rules to allow read/write (for now):
 *    {
 *      "rules": {
 *        ".read": true,
 *        ".write": true
 *      }
 *    }
 * 10. Add your GitHub Pages domain to authorized domains:
 *     Authentication > Settings > Authorized domains > Add domain
 *     Add: jdwmbtu.github.io
 */

const firebaseConfig = {
    apiKey: "AIzaSyBUqhg-G1mbRo5DLKzmT07rv_OEzgkiML4",
    authDomain: "feellove-dashboard-a1d78.firebaseapp.com",
    databaseURL: "https://feellove-dashboard-a1d78-default-rtdb.firebaseio.com",
    projectId: "feellove-dashboard-a1d78",
    storageBucket: "feellove-dashboard-a1d78.firebasestorage.app",
    messagingSenderId: "690293013722",
    appId: "1:690293013722:web:500b90b30a75b7b603b9e3"
};

// Initialize Firebase (only if config is set up)
if (firebaseConfig.apiKey !== "YOUR_API_KEY" && typeof firebase !== 'undefined') {
    try {
        firebase.initializeApp(firebaseConfig);
        console.log('Firebase initialized successfully');
    } catch (e) {
        console.warn('Firebase init error:', e.message);
    }
} else {
    console.log('Notes will save to localStorage (works on this device only)');
    console.log('To sync notes across devices, set up Firebase - see firebase-config.js');
}
