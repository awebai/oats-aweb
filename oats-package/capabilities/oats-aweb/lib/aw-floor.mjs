/** The one aw client floor: every path that needs aw, the probe and a grant
 *  seat's custody are held to it. aw 1.36.31 can reply to a sender outside
 *  the team roster, and its custody reports mail_reply_continuation.v1. */
export const AW_MIN = '1.36.31';
