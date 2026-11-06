import test from 'node:test';
import assert from 'node:assert/strict';
import { videoId } from './video-id';
test('accepts only YouTube IDs and trusted HTTPS URLs', () => {
  for (const input of ['M7lc1UVf-VE', 'https://youtu.be/M7lc1UVf-VE', 'https://www.youtube.com/watch?v=M7lc1UVf-VE&t=10']) assert.equal(videoId(input), 'M7lc1UVf-VE');
  for (const input of ['file:///test', 'javascript:alert(1)', 'https://youtube.com.evil.test/watch?v=M7lc1UVf-VE', 'https://evil.test/M7lc1UVf-VE', 'https://user:pass@youtube.com/watch?v=M7lc1UVf-VE', 'bad']) assert.equal(videoId(input), null);
});
