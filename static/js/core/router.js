// ==================================================
// ROUTER — page stack management (ES Module)
// ==================================================

export const PageStack = [];

export function pushPage(name) {
  PageStack.push(name);
}

export function popPage() {
  return PageStack.pop();
}

export function clearStack() {
  PageStack.length = 0;
}

export function getStack() {
  return PageStack;
}
