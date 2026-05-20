// User notification writer.
//
// Stores each notification at `user_notifications/{uid}/items/{id}`.
// The mobile NotificationsCubit subscribes to this collection ordered
// by created_at desc and renders a bell badge in the profile app bar.
//
// Why a sub-collection (not a flat `notifications` collection):
//   - Per-uid sub-collection means Firestore security rules can be
//     `allow read: if request.auth.uid == userId` — no extra
//     submitted_by_uid filtering, no risk of leaking another user's
//     items via a misconfigured query.
//   - No composite index needed: the mobile query is `orderBy
//     created_at desc limit 50` on a per-user sub-collection — the
//     single-field index Firestore auto-maintains is enough.
//
// Notification shape (Firestore doc):
//   {
//     kind: 'submission_approved' | 'submission_rejected'
//         | 'submission_updated'  | 'place_admin_updated',
//     title: 'Your place "Ataa Hospital" has been approved!',
//     body:  'It's now live for everyone to see.',
//     place_id?: string,        // tap → /place/<id>
//     submission_id?: string,   // tap → /profile (highlight tile)
//     admin_note?: string,      // surfaced inline for rejects
//     read: false,
//     created_at: serverTimestamp,
//     created_at_iso: string,
//   }
//
// Best-effort: failures are logged but never block the action that
// triggered them. An admin shouldn't see "approve failed" because a
// notification write hiccuped.

/// Write a notification for [uid]. Returns the new doc id, or null on
/// failure. NEVER throws — wrap callers don't need try/catch.
export async function writeUserNotification(db, uid, payload) {
  if (!db || !uid || !payload || typeof payload !== 'object') return null;
  try {
    const now = new Date();
    const ref = db
        .collection('user_notifications')
        .doc(uid)
        .collection('items')
        .doc();
    await ref.set({
      ...payload,
      read: false,
      created_at: now,
      created_at_iso: now.toISOString(),
    });
    return ref.id;
  } catch (e) {
    console.warn(
      `[notifications] write failed for uid=${uid.slice(0, 8)}: ${e.message}`
    );
    return null;
  }
}

/// Build a short headline for an admin-edit notification. Keeps the
/// copy positive — the user just had someone touch their submission;
/// the message shouldn't read like a complaint.
export function formatEditHeadline(placeTitle, changedFields) {
  const t = placeTitle || 'your submitted place';
  // Dedup labels — lat+lon both map to "location", primary_slug+type
  // both map to "category", etc. We don't want
  // "updated location and location for X".
  const labels = [];
  if (changedFields) {
    for (const f of changedFields) {
      const label = friendlyFieldName(f);
      if (!labels.includes(label)) labels.push(label);
    }
  }
  if (labels.length === 0) {
    return `An admin updated details for "${t}".`;
  }
  if (labels.length === 1) {
    return `Admin updated the ${labels[0]} for "${t}".`;
  }
  const last = labels[labels.length - 1];
  const head = labels.slice(0, -1).join(', ');
  return `Admin updated ${head} and ${last} for "${t}".`;
}

/// Map internal field names to user-friendly labels.
function friendlyFieldName(field) {
  switch (field) {
    case 'title': return 'title';
    case 'place_id': return 'place ID';
    case 'type': return 'category';
    case 'primary_slug': return 'category';
    case 'lat': return 'location';
    case 'lon': return 'location';
    case 'address': return 'address';
    case 'phone': return 'phone';
    case 'website': return 'website';
    case 'thumbnail': return 'photo';
    case 'rating': return 'rating';
    case 'reviews': return 'reviews';
    case 'source_categories': return 'categories';
    default: return field.replace(/_/g, ' ');
  }
}
