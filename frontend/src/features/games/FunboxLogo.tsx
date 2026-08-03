import Link from "next/link";

export function FunboxLogo({ linked = true }: { linked?: boolean }) {
  const logo = (
    <div className="funbox-logo" aria-label="Funbox">
      <span className="logo-pink">F</span><span className="logo-purple">U</span>
      <span className="logo-cyan">N</span><span className="logo-pink">B</span>
      <span className="logo-purple logo-face">O</span><span className="logo-lime">X</span>
    </div>
  );

  return linked ? <Link className="logo-link" href="/">{logo}</Link> : logo;
}
