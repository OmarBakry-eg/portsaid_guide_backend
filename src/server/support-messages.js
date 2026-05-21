// Threaded messages on reports + inquiries.
//
// Sub-collection layout:
//   place_reports/{id}/messages/{auto-id}
//   place_inquiries/{id}/messages/{auto-id}
//
// Each message:
//   {
//     body: string (≤2000 chars),
//     author: 'admin' | 'user',
//     author_uid?: string,        // present when author === 'user'
//     created_at: Timestamp,
//     created_at_iso: string,
//   }
//
// On every post we ALSO denormalise summary fields onto the parent
// (report / inquiry) doc:
//   last_message_at: Timestamp
//   last_message_at_iso: string
//   last_message_author: 'admin' | 'user'
//   last_message_preview: first 120 chars of body
//   admin_unread_count: increment on user msg, reset to 0 on
//                       /mark-read by admin
//   user_unread_count:  increment on admin msg, reset on user
//                       /mark-read
// These let both the dashboard list view AND the mobile profile
// tile render unread badges + previews without fetching the thread.
//
// We notify the OTHER party on every message:
//   admin → user: writeUserNotification + FCM push to the submitter
//   user → admin: live-store picks up the report/inquiry-doc update
//                 automatically (admin_unread_count increment), no
//                 separate push needed since admin browses the
//                 dashboard.

import { getFirestore } from '../pipeline/firestore.js';
import {
  writeUserNotification,
} from './dashboard/notifications.js';
import {
  FieldValue,
} from 'firebase-admin/firestore';

/// Collection name guard. Only these two parents support messaging
/// — passing any other string throws so a typo in a route handler
/// can't accidentally write to /places/X/messages.
const ALLOWED_PARENTS = new Set(['place_reports', 'place_inquiries']);

function assertParent(parentCollection) {
  if (!ALLOWED_PARENTS.has(parentCollection)) {
    throw new Error(`Unsupported parent collection: ${parentCollection}`);
  }
}

/// Post a message. Updates the parent doc's denormalised summary
/// fields in the same write (so list views render unread + preview
/// without a sub-collection fetch). Fires a notification when
/// appropriate.
///
/// Args:
///   db: Firestore client
///   parentCollection: 'place_reports' | 'place_inquiries'
///   parentId: parent doc id
///   author: 'admin' | 'user'
///   authorUid: uid when author === 'user', else null/undefined
///   body: the message text
///
/// Returns { id, parent_id, last_message_at_iso, author }.
export async function postMessage({
  db,
  parentCollection,
  parentId,
  author,
  authorUid = null,
  body,
}) {
  assertParent(parentCollection);
  if (!parentId) throw new Error('parentId is required');
  if (author !== 'admin' && author !== 'user') {
    throw new Error('author must be "admin" or "user"');
  }
  const cleanBody = (body || '').toString().trim().slice(0, 2000);
  if (!cleanBody) throw new Error('body is required');

  const parentRef = db.collection(parentCollection).doc(parentId);
  const parentSnap = await parentRef.get();
  if (!parentSnap.exists) {
    throw new Error(`${parentCollection}/${parentId} not found`);
  }
  const parentData = parentSnap.data();

  // When the user posts, verify they own this report/inquiry. Reports
  // store the reporter under reported_by_uid; inquiries store under
  // user_uid. Admin posts skip the check.
  if (author === 'user') {
    const ownerField = parentCollection === 'place_reports'
        ? 'reported_by_uid'
        : 'user_uid';
    if (parentData[ownerField] !== authorUid) {
      throw new Error('not the owner of this thread');
    }
  }

  const now = new Date();
  const msgRef = parentRef.collection('messages').doc();
  const msg = {
    body: cleanBody,
    author,
    author_uid: author === 'user' ? authorUid : null,
    created_at: now,
    created_at_iso: now.toISOString(),
  };
  // Drop nulls — we don't need an empty author_uid field for admin
  // messages.
  if (msg.author_uid == null) delete msg.author_uid;

  // Denormalise summary onto the parent doc. Increment the unread
  // counter for whichever side did NOT author this message — the
  // other side hasn't seen it yet.
  const parentUpdate = {
    last_message_at: now,
    last_message_at_iso: now.toISOString(),
    last_message_author: author,
    last_message_preview: cleanBody.slice(0, 120),
  };
  if (author === 'user') {
    parentUpdate.admin_unread_count = FieldValue.increment(1);
  } else {
    parentUpdate.user_unread_count = FieldValue.increment(1);
  }

  // Two writes — message doc + parent denormalisation. Could be a
  // batch, but a sub-collection write + parent update is two
  // different paths anyway. The listener on the parent collection
  // picks up both events independently.
  await msgRef.set(msg);
  await parentRef.update(parentUpdate);

  // Fire the cross-party notification.
  if (author === 'admin') {
    // Notify the user. Reports use reported_by_uid, inquiries use
    // user_uid — both stored alongside the reporter's email.
    const recipientUid = parentCollection === 'place_reports'
        ? parentData.reported_by_uid
        : parentData.user_uid;
    if (recipientUid) {
      const kind = parentCollection === 'place_reports'
          ? 'report_reply'
          : 'inquiry_reply';
      const heading = parentCollection === 'place_reports'
          ? 'New reply on your report'
          : 'New reply on your inquiry';
      writeUserNotification(db, recipientUid, {
        kind,
        title: heading,
        body: cleanBody.slice(0, 200),
        place_id: parentData.place_id || null,
        thread_kind: parentCollection,
        thread_id: parentId,
      });
    }
  }
  // user → admin notification is implicit: the live-store will pick
  // up the parent's admin_unread_count increment, and the dashboard
  // surfaces that as a badge.

  return {
    id: msgRef.id,
    parent_id: parentId,
    last_message_at_iso: now.toISOString(),
    author,
  };
}

/// List messages for a thread, oldest first. Used by both the
/// admin dashboard's expansion and the mobile's thread page.
///
/// For low-cost reads on Render (no Firestore listeners per request)
/// this returns the docs directly via a single .get(). Each request
/// costs `messageCount` reads — typical thread is <20 messages, so
/// well under the dashboard's normal headroom.
export async function listMessages({
  db,
  parentCollection,
  parentId,
  limit = 200,
}) {
  assertParent(parentCollection);
  const snap = await db
      .collection(parentCollection)
      .doc(parentId)
      .collection('messages')
      .orderBy('created_at', 'asc')
      .limit(limit)
      .get();
  return snap.docs.map((d) => {
    const m = d.data();
    return {
      id: d.id,
      body: m.body,
      author: m.author,
      author_uid: m.author_uid || null,
      created_at: m.created_at_iso ||
          (typeof m.created_at?.toDate === 'function'
              ? m.created_at.toDate().toISOString() : null),
    };
  });
}

/// Reset the unread counter for one side of the thread. Called when
/// the dashboard opens a report/inquiry expansion (admin) or when
/// the mobile opens the thread page (user).
export async function markThreadRead({
  db,
  parentCollection,
  parentId,
  side,
}) {
  assertParent(parentCollection);
  if (side !== 'admin' && side !== 'user') {
    throw new Error('side must be "admin" or "user"');
  }
  const field = side === 'admin' ? 'admin_unread_count' : 'user_unread_count';
  await db.collection(parentCollection).doc(parentId).update({
    [field]: 0,
    [`${side}_last_read_at`]: new Date(),
  });
  return { ok: true };
}
