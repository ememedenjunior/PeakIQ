import { get, set, del, keys } from 'idb-keyval';
import { api } from './api';

// Offline packages are keyed per user so one student's paid downloads are never
// served to another account on the same device.
const pkgKey = (userId, courseId) => `course:${userId}:${courseId}`;
const QUEUE_KEY = 'peakiq_progress_queue';

export async function downloadCourse(userId, courseId) {
  const pkg = await api(`/courses/${courseId}/offline`); // server verifies payment
  await set(pkgKey(userId, courseId), pkg);
  return pkg;
}

export const getOfflineCourse = (userId, courseId) => get(pkgKey(userId, courseId));
export const removeOfflineCourse = (userId, courseId) => del(pkgKey(userId, courseId));

export async function listOfflineCourseIds(userId) {
  const prefix = `course:${userId}:`;
  return (await keys()).filter((k) => typeof k === 'string' && k.startsWith(prefix)).map((k) => k.slice(prefix.length));
}

// ---- progress made while offline is queued and synced later ----
const readQueue = () => {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
};

export function queueProgress(item) {
  const q = readQueue();
  if (!q.some((i) => i.lessonId === item.lessonId)) q.push(item);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

export async function flushProgressQueue() {
  const q = readQueue();
  const remaining = [];
  for (const item of q) {
    try {
      await api('/learning/progress', { method: 'POST', body: item });
    } catch (e) {
      if (e.status === 0) remaining.push(item); // still offline, keep it
      // other errors (e.g. no longer enrolled) are dropped
    }
  }
  localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
}
