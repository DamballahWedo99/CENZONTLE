// Allow TypeScript to accept dynamic imports of CSS files (e.g. xterm.css).
// The modules resolve to `void` because CSS imports have no runtime value.
declare module '*.css' {
  const stylesheet: void;
  export default stylesheet;
}
