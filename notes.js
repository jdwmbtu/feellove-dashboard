/**
 * Notes Manager - Handles per-staff and day notes with Firebase persistence
 * Falls back to localStorage if Firebase is not configured
 */

const NotesManager = {
    db: null,
    isFirebaseReady: false,
    listeners: new Map(),

    /**
     * Initialize the notes manager
     * Call this after Firebase is loaded (or skip if using localStorage fallback)
     */
    init() {
        if (typeof firebase !== 'undefined' && firebase.database) {
            this.db = firebase.database();
            this.isFirebaseReady = true;
            console.log('NotesManager: Firebase connected');
        } else {
            console.log('NotesManager: Using localStorage fallback');
        }
    },

    /**
     * Get the storage key for localStorage fallback
     */
    _getStorageKey(store, date) {
        return `feellove_notes_${store}_${date}`;
    },

    /**
     * Load all notes for a store on a given date
     * @param {string} store - Store name (CAFE, FEELLOVE, SNOW, ZION)
     * @param {string} date - Date string (YYYY-MM-DD format)
     * @returns {Promise<{staff: Object, dayNote: string}>}
     */
    async loadNotes(store, date) {
        if (this.isFirebaseReady) {
            try {
                const snapshot = await this.db.ref(`notes/${store}/${date}`).once('value');
                const data = snapshot.val() || {};
                return {
                    staff: data.staff || {},
                    dayNote: data.dayNote?.note || ''
                };
            } catch (err) {
                console.error('NotesManager: Firebase load error', err);
                return this._loadFromLocalStorage(store, date);
            }
        } else {
            return this._loadFromLocalStorage(store, date);
        }
    },

    _loadFromLocalStorage(store, date) {
        try {
            const key = this._getStorageKey(store, date);
            const data = JSON.parse(localStorage.getItem(key) || '{}');
            return {
                staff: data.staff || {},
                dayNote: data.dayNote || ''
            };
        } catch (err) {
            console.error('NotesManager: localStorage load error', err);
            return { staff: {}, dayNote: '' };
        }
    },

    /**
     * Save a note for a specific staff member
     * @param {string} store - Store name
     * @param {string} date - Date string (YYYY-MM-DD)
     * @param {string} employee - Employee name
     * @param {string} note - Note content
     */
    async saveStaffNote(store, date, employee, note) {
        const timestamp = Date.now();

        if (this.isFirebaseReady) {
            try {
                await this.db.ref(`notes/${store}/${date}/staff/${employee}`).set({
                    note: note,
                    updatedAt: timestamp
                });
                return true;
            } catch (err) {
                console.error('NotesManager: Firebase save error', err);
                return this._saveToLocalStorage(store, date, employee, note);
            }
        } else {
            return this._saveToLocalStorage(store, date, employee, note);
        }
    },

    _saveToLocalStorage(store, date, employee, note) {
        try {
            const key = this._getStorageKey(store, date);
            const data = JSON.parse(localStorage.getItem(key) || '{}');
            if (!data.staff) data.staff = {};
            data.staff[employee] = { note: note, updatedAt: Date.now() };
            localStorage.setItem(key, JSON.stringify(data));
            return true;
        } catch (err) {
            console.error('NotesManager: localStorage save error', err);
            return false;
        }
    },

    /**
     * Save the day note for a store
     * @param {string} store - Store name
     * @param {string} date - Date string (YYYY-MM-DD)
     * @param {string} note - Note content
     */
    async saveDayNote(store, date, note) {
        const timestamp = Date.now();

        if (this.isFirebaseReady) {
            try {
                await this.db.ref(`notes/${store}/${date}/dayNote`).set({
                    note: note,
                    updatedAt: timestamp
                });
                return true;
            } catch (err) {
                console.error('NotesManager: Firebase save error', err);
                return this._saveDayNoteToLocalStorage(store, date, note);
            }
        } else {
            return this._saveDayNoteToLocalStorage(store, date, note);
        }
    },

    _saveDayNoteToLocalStorage(store, date, note) {
        try {
            const key = this._getStorageKey(store, date);
            const data = JSON.parse(localStorage.getItem(key) || '{}');
            data.dayNote = note;
            localStorage.setItem(key, JSON.stringify(data));
            return true;
        } catch (err) {
            console.error('NotesManager: localStorage save error', err);
            return false;
        }
    },

    /**
     * Subscribe to real-time updates for notes
     * @param {string} store - Store name
     * @param {string} date - Date string (YYYY-MM-DD)
     * @param {function} callback - Called when notes change
     * @returns {function} Unsubscribe function
     */
    subscribeToNotes(store, date, callback) {
        if (this.isFirebaseReady) {
            const ref = this.db.ref(`notes/${store}/${date}`);
            const handler = (snapshot) => {
                const data = snapshot.val() || {};
                callback({
                    staff: data.staff || {},
                    dayNote: data.dayNote?.note || ''
                });
            };
            ref.on('value', handler);

            // Return unsubscribe function
            return () => ref.off('value', handler);
        } else {
            // No real-time updates with localStorage, just load once
            this.loadNotes(store, date).then(callback);
            return () => {};
        }
    },

    /**
     * Get note for a specific employee
     * @param {string} store - Store name
     * @param {string} date - Date string (YYYY-MM-DD)
     * @param {string} employee - Employee name
     * @returns {Promise<string>}
     */
    async getStaffNote(store, date, employee) {
        const notes = await this.loadNotes(store, date);
        return notes.staff[employee]?.note || '';
    }
};

// Auto-initialize when script loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => NotesManager.init());
} else {
    NotesManager.init();
}
