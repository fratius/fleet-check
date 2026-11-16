// Stand-in for the phone's image module in Node tests (tests/alias.mjs); the photo check's maths is tested with made-up pixels.
export const SaveFormat = { JPEG: 'jpeg' };
export const ImageManipulator = { manipulate() { throw new Error('No image module in Node tests'); } };
