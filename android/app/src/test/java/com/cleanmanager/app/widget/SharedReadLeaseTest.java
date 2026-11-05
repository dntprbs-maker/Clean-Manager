package com.cleanmanager.app.widget;

import org.junit.Test;
import static org.junit.Assert.*;

public class SharedReadLeaseTest {
    @Test public void leaseDefersOnlyCoveredSameSessionAndRevision() {
        SharedReadLease lease = new SharedReadLease();
        lease.begin("session", 7L, "2026-11-01", "2026-11-30", 100L, 1_000L);
        assertTrue(lease.shouldDefer("session", 7L, "2026-11-05", "2026-11-20", 1_001L));
        assertFalse(lease.shouldDefer("other", 7L, "2026-11-05", "2026-11-20", 1_001L));
    }
    @Test public void latestRequestWinsAndFencesEarlierNativeResponse() {
        SharedReadLease lease = new SharedReadLease();
        long nativeFence = lease.fence();
        SharedReadLease.Ticket first = lease.begin("session", 0L, "2026-11-01", "2026-11-30", 100L, 1_000L);
        SharedReadLease.Ticket last = lease.begin("session", 0L, "2026-11-01", "2026-11-30", 101L, 1_001L);
        assertNull(lease.current(first.id, "session", 0L, 1_002L));
        assertNotNull(lease.current(last.id, "session", 0L, 1_002L));
        assertFalse(lease.mayPublish(nativeFence));
        assertFalse(lease.finish(first.id));
        assertTrue(lease.finish(last.id));
    }
    @Test public void cancellationReleasesOnlyMatchingTicket() {
        SharedReadLease lease = new SharedReadLease();
        SharedReadLease.Ticket ticket = lease.begin("session", 0L, "2026-11-01", "2026-11-30", 100L, 1_000L);
        assertFalse(lease.finish("unrelated"));
        assertNotNull(lease.current(ticket.id, "session", 0L, 1_001L));
        assertTrue(lease.finish(ticket.id));
        assertFalse(lease.shouldDefer("session", 0L, "2026-11-01", "2026-11-30", 1_001L));
    }
    @Test public void expiryUsesElapsedTimeAndReleasesFallbackAtFifteenSeconds() {
        SharedReadLease lease = new SharedReadLease();
        SharedReadLease.Ticket ticket = lease.begin("session", 0L, "2026-11-01", "2026-11-30", 100L, 1_000L);
        assertNotNull(lease.current(ticket.id, "session", 0L, 15_999L));
        assertNull(lease.current(ticket.id, "session", 0L, 16_000L));
        assertTrue(lease.expire(ticket.id, 16_000L));
        assertFalse(lease.expire(ticket.id, 16_001L));
    }
    @Test public void mutationOrExplicitForceInvalidatesOutstandingTicket() {
        SharedReadLease lease = new SharedReadLease();
        SharedReadLease.Ticket ticket = lease.begin("session", 4L, "2026-11-01", "2026-11-30", 100L, 1_000L);
        assertNull(lease.current(ticket.id, "session", 5L, 1_001L));
        lease.invalidate();
        assertNull(lease.current(ticket.id, "session", 4L, 1_001L));
    }
    @Test public void navigationOutsideLeasedRangeResumesIndependentRead() {
        SharedReadLease lease = new SharedReadLease();
        SharedReadLease.Ticket ticket = lease.begin("session", 0L, "2026-11-01", "2026-11-30", 100L, 1_000L);
        assertFalse(lease.shouldDefer("session", 0L, "2026-12-01", "2026-12-31", 1_001L));
        assertNull(lease.current(ticket.id, "session", 0L, 1_001L));
    }
}
