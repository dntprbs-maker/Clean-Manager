package com.cleanmanager.app.widget;

import java.util.UUID;

/** One latest-wins lease. Elapsed time, not wall clock, controls its lifetime. */
final class SharedReadLease {
    static final long LEASE_MS = 15_000L;
    static final class Ticket {
        final String id, scope, from, to;
        final long revision, issuedWall, issuedElapsed;
        Ticket(String scope, long revision, String from, String to, long wall, long elapsed) {
            this.id = UUID.randomUUID().toString(); this.scope = scope; this.revision = revision;
            this.from = from; this.to = to; this.issuedWall = wall; this.issuedElapsed = elapsed;
        }
    }
    private Ticket active;
    private long epoch;

    synchronized Ticket begin(String scope, long revision, String from, String to, long wall, long elapsed) {
        epoch++;
        return active = new Ticket(scope, revision, from, to, wall, elapsed);
    }
    synchronized Ticket current(String id, String scope, long revision, long elapsed) {
        if (active == null || !active.id.equals(id) || !active.scope.equals(scope) || active.revision != revision
                || elapsed < active.issuedElapsed || elapsed - active.issuedElapsed >= LEASE_MS) return null;
        return active;
    }
    synchronized boolean shouldDefer(String scope, long revision, String from, String to, long elapsed) {
        if (active == null) return false;
        if (current(active.id, scope, revision, elapsed) == null
                || active.from.compareTo(from) > 0 || active.to.compareTo(to) < 0) {
            invalidate(); return false;
        }
        return true;
    }
    synchronized boolean finish(String id) {
        if (active == null || !active.id.equals(id)) return false;
        active = null; epoch++; return true;
    }
    synchronized boolean expire(String id, long elapsed) {
        if (active == null || !active.id.equals(id) || elapsed - active.issuedElapsed < LEASE_MS) return false;
        return finish(id);
    }
    synchronized void invalidate() { active = null; epoch++; }
    synchronized long fence() { return epoch; }
    synchronized boolean mayPublish(long expectedEpoch) { return epoch == expectedEpoch; }
}
