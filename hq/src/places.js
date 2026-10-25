/* The eleven sections of the HQ, in nav order.
   The router, the nav, the command palette and the URL all read this one list.
   A place cannot exist in the router and be missing from the nav the way Money,
   Tasks, Content plan and Pipeline were. */
import { Activity, Building2, Clapperboard, Droplet, FileSignature, House, Instagram, ListTodo, PanelsTopLeft, Target, Users, Wallet } from "lucide-react";

/* Every section of the HQ, in nav order. The router, the nav, the command
   palette and the URL all read this one list, so a place cannot exist in the
   router and be missing from the nav the way Money, Tasks, Content plan and
   Pipeline were. */
export const PLACES = [
  { id: 'home', label: 'Home court', short: 'Home', tier: 'room', icon: House, hint: 'Your day and next move' },
  { id: 'room', label: 'Canvas', short: 'Canvas', tier: 'room', icon: PanelsTopLeft, hint: 'Notes and ideas, together' },
  { id: 'workspaces', label: 'Clients', short: 'Clients', tier: 'room', icon: Building2, hint: 'Clients, projects and next steps' },
  { id: 'film', label: 'Meetings', short: 'Meetings', tier: 'room', icon: Clapperboard, hint: 'Record, transcribe and review' },
  { id: 'tasks', label: 'Tasks', short: 'Tasks', tier: 'tool', icon: ListTodo, hint: 'Work that needs doing' },
  { id: 'money', label: 'Money', short: 'Money', tier: 'tool', icon: Wallet, hint: 'Income, expenses and invoices', ownerOnly: true },
  { id: 'monitor', label: 'Sites', short: 'Sites', tier: 'tool', icon: Activity, hint: 'Uptime, visitors and site errors', ownerOnly: true },
  { id: 'paperwork', label: 'Paperwork', short: 'Paper', tier: 'tool', icon: FileSignature, hint: 'Proposals, agreements and receipts', ownerOnly: true }
];

/* Only places a person can reach. A saved place, a bookmark or a pasted link
   that names a hidden one lands on Home. */
/* Old links and saved places land where the thing now lives. */
export const PLACE_ALIASES = { pipeline: "workspaces", clients: "workspaces" };

export const PLACE_IDS = PLACES.filter((entry) => !entry.hidden).map((entry) => entry.id);

export function actorCanAccessPlace(actor, place, modules = {}) {
  const entry = PLACES.find((item) => item.id === place);
  return Boolean(entry && modules[entry.id] !== false && !entry.hidden && (!entry.ownerOnly || actor?.role === "owner"));
}

export function placesForActor(actor, modules = {}) {
  return PLACES.filter((entry) => modules[entry.id] !== false && !entry.hidden && (!entry.ownerOnly || actor?.role === "owner"));
}
