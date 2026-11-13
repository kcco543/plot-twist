/** Re-mounts on every navigation, giving each screen a stepped pixel "slide in". */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-screen-in">{children}</div>;
}
