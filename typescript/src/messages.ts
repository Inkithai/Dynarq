// The email text for a planned reminder (part 3 of the task).
//
// The wording is deliberately plain. It repeats only what is in the invoice
// data: no fees, no interest, no payment deadlines, and no mention of earlier
// reminders. The legal wording is the owner's decision later, which is what
// part 4 of the task is about.

import { formatIsoDate } from "./dates.js";
import type { Invoice, ReminderStep } from "./invoice.js";

/** "EUR 1250.00": the currency and two decimals. */
export function formatAmount(amount: number, currency: string): string {
  const value = amount.toFixed(2);
  return currency === "" ? value : `${currency} ${value}`;
}

/** The email the customer would receive for one reminder step. */
export function buildReminderMessage(invoice: Invoice, step: ReminderStep, daysOverdue: number): string {
  const overdue = daysOverdue === 1 ? "1 day overdue" : `${daysOverdue} days overdue`;
  const { subject, paragraphs } = messageText(step, invoice, overdue);
  return [
    `Subject: ${subject}`,
    "",
    `Dear ${invoice.customer},`,
    "",
    ...paragraphs,
    "",
    "Kind regards,",
    "Accounts Receivable",
  ].join("\n");
}

interface MessageText {
  subject: string;
  paragraphs: string[];
}

function messageText(step: ReminderStep, invoice: Invoice, overdue: string): MessageText {
  const amount = formatAmount(invoice.amount, invoice.currency);
  const dueDate = formatIsoDate(invoice.dueDate);
  const opening = `Invoice ${invoice.id} for ${amount} was due on ${dueDate} and is now ${overdue}.`;

  switch (step) {
    case "friendly":
      return {
        subject: `Friendly reminder: invoice ${invoice.id} is ${overdue}`,
        paragraphs: [
          `Our records show that ${opening}`,
          "If the payment is already on its way, please ignore this note. Otherwise, please arrange payment at your convenience. If anything is unclear, just reply to this email and we will be happy to help.",
        ],
      };
    case "firm":
      return {
        subject: `Reminder: invoice ${invoice.id} is ${overdue}`,
        paragraphs: [
          `${opening} We have not yet received the payment.`,
          "Please arrange payment of the outstanding amount as soon as possible. If the payment is already scheduled, or if there is a problem with the invoice, please reply to this email so that we can sort it out.",
        ],
      };
    case "final":
      return {
        subject: `Final reminder: invoice ${invoice.id} is ${overdue}`,
        paragraphs: [
          `${opening} This is our final reminder about this invoice.`,
          "Please arrange payment of the outstanding amount as a matter of urgency. If you believe this invoice has already been paid, or if there is a problem with it, please contact us straight away.",
        ],
      };
  }
}
