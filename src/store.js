'use strict';

class EventStore {
  constructor() {
    this._events = new Map(); // eventId -> record
  }

  /**
   * Atomically creates a record for eventId if one does not already exist.
   * Node.js runs synchronous code without interleaving, so this
   * check-and-set (no `await` between the check and the `set`) is safe
   * against concurrent duplicate submissions arriving in the same process.
   *
   * Returns { record, created } where created=false means an existing
   * record was returned instead of a new one being made.
   */
  getOrCreate(eventId, factory) {
    const existing = this._events.get(eventId);
    if (existing) {
      return { record: existing, created: false };
    }
    const record = factory();
    this._events.set(eventId, record);
    return { record, created: true };
  }

  get(eventId) {
    return this._events.get(eventId) || null;
  }

  all() {
    return Array.from(this._events.values());
  }
}

module.exports = { EventStore };
