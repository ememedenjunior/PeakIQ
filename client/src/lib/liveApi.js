import { api } from './api';

export const liveApi = {
  active: () => api('/live/active'),
  start: (courseId, data) => api(`/live/courses/${courseId}/start`, { method: 'POST', body: data || {} }),
  get: (id) => api(`/live/${id}`),
  end: (id) => api(`/live/${id}/end`, { method: 'POST', body: {} }),
  sessions: (courseId) => api(`/live/courses/${courseId}/sessions`),
  attendance: (id) => api(`/live/${id}/attendance`),
};
