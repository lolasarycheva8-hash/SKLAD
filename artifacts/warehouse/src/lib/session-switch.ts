const SESSION_SWITCH_TICKET_KEY = "clerk.session-switch-ticket";

export function queueSessionSwitch(ticket: string): void {
  sessionStorage.setItem(SESSION_SWITCH_TICKET_KEY, ticket);
  window.location.assign(`${import.meta.env.BASE_URL}session-switch`);
}

export function takeSessionSwitchTicket(): string | null {
  const ticket = sessionStorage.getItem(SESSION_SWITCH_TICKET_KEY);
  sessionStorage.removeItem(SESSION_SWITCH_TICKET_KEY);
  return ticket;
}