import React from "react";
import agent4Avatar from "../assets/falcon.svg";

/* Agent4's face, at the three sizes the app uses it. Decorative everywhere it
   appears, so it carries an empty alt and never a name. */

export function Agent4Avatar({ size = "small" }) {
  return <img className={`agent4-avatar agent4-avatar--${size}`} src={agent4Avatar} alt="" />;
}
