import React from "react";

export function DeliveryPhotosDialog({ open }: { open: boolean }) {
  return open ? <div role="dialog" data-testid="acts-dialog">Акты доставки</div> : null;
}