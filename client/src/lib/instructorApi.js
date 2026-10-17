import { api } from './api';

const call = (path, method = 'GET', body) => (method === 'GET' ? api(path) : api(path, { method, body }));

export const instructorApi = {
  listCourses: () => call('/instructor/courses'),
  createCourse: (data) => call('/instructor/courses', 'POST', data),
  getCourse: (id) => call(`/instructor/courses/${id}`),
  saveCourse: (id, data) => call(`/instructor/courses/${id}`, 'PUT', data),
  deleteCourse: (id) => call(`/instructor/courses/${id}`, 'DELETE'),
  publish: (id) => call(`/instructor/courses/${id}/publish`, 'POST', {}),
  unpublish: (id) => call(`/instructor/courses/${id}/unpublish`, 'POST', {}),
  submissions: (id, status) => call(`/instructor/courses/${id}/submissions${status ? `?status=${status}` : ''}`),
  grade: (submissionId, data) => call(`/instructor/submissions/${submissionId}`, 'PATCH', data),
};

// The server sends { message, problems: [...] } on publish/save checks; ApiError exposes them directly.
export const problemsOf = (e) => e?.problems || [];
