// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// "Send an SMS": the recipients and the text are `string` fields, so Gladys
// substitutes the scene variables in them before the action reaches the
// integration ("{{triggerEvent.data.sender}}", the value of a sensor, the
// answer of the AI). Refused sends (invalid number, empty text, hourly limit
// reached, phone unreachable) throw: Gladys logs the reason and the scene
// goes on with the next action.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async send_sms(hub, { fields = {} }) {
    const result = await hub.send({
      recipients: fields.phone_numbers,
      text: fields.message,
      sim: fields.sim_number,
      device: fields.device,
      origin: 'scene',
    });
    return { message_id: result.id, recipients: result.recipients, state: result.status };
  },
};
