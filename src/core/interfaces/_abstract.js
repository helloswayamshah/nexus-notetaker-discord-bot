// src/core/interfaces/_abstract.js
class NotImplementedError extends Error {
  constructor(method) {
    super(`${method} must be implemented by subclass`);
    this.name = 'NotImplementedError';
  }
}
module.exports = { NotImplementedError };
