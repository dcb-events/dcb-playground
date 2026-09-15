# Primary-source grounding for the "define a command" redesign

Date: 2026-09-13
Scope: three proposed changes to the command-definition page in `app/index.html`
(see `stepTrigger` / `propertyAdder` around `app/index.html:3283`).

1. **Progressive disclosure** — reveal the six steps (trigger, reads, rules, emits,
   changes, consistency) one at a time rather than all at once.
2. **Implicit commit on naming** — a payload property row is created as soon as it has a
   name, replacing the "+ Add input" confirm button.
3. **Inline creation without losing scope** — create a missing entity or entity property
   from inside the command page, without navigating away.

## What counts as a primary source here

| Tier | Sources used | Status |
|---|---|---|
| Normative standards | WCAG 2.2 (W3C Recommendation), WAI-ARIA 1.2 (W3C Recommendation), HTML Living Standard (WHATWG) | Binding / normative text |
| First-party non-normative W3C material | WCAG 2.2 *Understanding* docs, WCAG *Techniques* and *Failures*, ARIA Authoring Practices Guide (APG), WAI Forms Tutorial | Explicitly labelled "Informative explanations, not required to meet WCAG" — authoritative as author intent, not as requirements |
| First-party design systems | GOV.UK Design System + GOV.UK Service Manual, Apple Human Interface Guidelines | First-party documentation, opinionated, not normative |
| **Not obtained** | Material Design 3 | See [Gaps](#gaps-where-there-is-no-primary-source) |

No blog posts, no secondary write-ups. Where a claim is only a judgement call, it is
flagged as such rather than backed with a weaker source.

---

## Q1. What does WCAG 3.2.2 forbid, and does "a new empty row appears when I type a name" cross the line?

### The normative text

**Success Criterion 3.2.2 On Input (Level A)** —
<https://www.w3.org/TR/WCAG22/#on-input>

> Changing the setting of any user interface component does not automatically cause a
> change of context unless the user has been advised of the behavior before using the
> component.

The neighbouring criterion, **3.2.1 On Focus (Level A)** —
<https://www.w3.org/TR/WCAG22/#on-focus>

> When any user interface component receives focus, it does not initiate a change of
> context.

Everything turns on the defined term. **"changes of context"**, WCAG 2.2 glossary —
<https://www.w3.org/TR/WCAG22/#dfn-change-of-context>

> major changes that, if made without user awareness, can disorient users who are not
> able to view the entire page simultaneously
>
> Changes in context include changes of:
>
> 1. user agent;
> 2. viewport;
> 3. focus;
> 4. content that changes the meaning of the web page
>
> **Note**
> A change of content is not always a change of context. Changes in content, such as an
> expanding outline, dynamic menu, or a tab control do not necessarily change the
> context, unless they also change one of the above (e.g., focus).
>
> **Example**
> Opening a new window, moving focus to a different component, going to a new page
> (including anything that would look to a user as if they had moved to a new page) or
> significantly re-arranging the content of a page are examples of changes of context.

And the *Understanding* document makes the exemption explicit — Understanding SC 3.2.2,
"Sufficient Techniques" note — <https://www.w3.org/WAI/WCAG22/Understanding/on-input.html>

> A change of content is not always a change of context. This success criterion is
> **automatically met** if changes in content are not also changes of context.

### Verdict for proposal 2

**Adding a row is a change of content, not a change of context — it does not cross the
3.2.2 line, provided nothing moves focus.** The criterion is *automatically met* in that
case, by the note quoted above.

The trap is bullet 3 of the definition: **focus** is itself listed as a change of
context. So the *design decision most people reach for* — "type a name, and focus jumps
into the new row's type field" — is exactly what converts a compliant content change
into a Level A failure. Under 3.2.2, automatic focus movement caused by typing a value
is a change of context caused by changing a setting, and it is only permissible if the
user "has been advised of the behavior before using the component."

WCAG's own intent text confirms typing counts as "changing the setting" —
Understanding SC 3.2.2, Intent:

> The intent of this success criterion is to ensure that entering data or selecting a
> form control has predictable effects. Changing the setting of any user interface
> component is changing some aspect in the control that will persist when the user is no
> longer interacting with it. So checking a checkbox, **entering text into a text
> field**, or changing the selected option in a list control changes its setting, but
> activating a link or a button does not.

Note the second half: **pressing "+ Add input" is activating a control, not changing a
setting** — which is precisely why the current design is trivially safe and the proposed
one needs care. That is the whole substance of the accessibility trade here.

WCAG endorses the "reveal more fields" shape directly. Understanding SC 3.2.2, Examples:

> A form is provided for creating calendar entries [...] a select dropdown allows the
> user to choose the type of calendar entry to create. [...] If the user selects the
> meeting option, additional fields are displayed on the page for entering the meeting
> participants. Different fields appear if the reminder option is chosen. **Because only
> parts of the entry change and the overall structure remains the same, the basic
> context remains for the user.**

And it endorses automatic focus movement *when forewarned* — same Examples section:

> A form contains fields representing US phone numbers. [...] When the user completes the
> entry of one field the focus automatically moves to the next field of the phone number.
> **This behavior of phone fields is described for the user at the beginning of the
> form.**

### The adjacent failure worth reading

**F36: Failure of SC 3.2.2 due to automatically submitting a form and presenting new
content without prior warning when the last field in the form is given a value** —
<https://www.w3.org/WAI/WCAG22/Techniques/failures/F36>

> Forms are frequently designed so that they submit automatically when the user has
> filled in all the fields, or when focus leaves the last field. There are two problems
> with this approach. First is that a disabled user who needs more context may move focus
> away from the field to the directions on how to fill in the form, or to other text,
> **accidentally submitting the form**. The other is that, with some form elements, the
> value of the field changes as each item is navigated with the keyboard, again
> accidentally submitting the form. It is better to rely on the standard form behavior of
> the submit button and enter key.

F36 does not apply literally — proposal 2 creates a row, it does not submit and navigate.
But the *reasoning* transfers exactly: someone tabbing away to read a hint, or arrowing
through a datalist, triggers the commit they did not intend. Design the implicit commit
so that the accidental case is cheap (see Q3 on undo).

---

## Q2. Focus handling for an implicitly created row, and what must be announced

### Focus: "stay put" is the well-supported default

There is **no pattern in the ARIA APG covering an implicitly created form row**. The APG
publishes 30 patterns (<https://www.w3.org/WAI/ARIA/apg/patterns/>) — none for forms,
wizards, steppers, or "add another". Its 7 practices
(<https://www.w3.org/WAI/ARIA/apg/practices/>) cover landmarks, accessible names,
keyboard interface, grid/table properties, range widgets, structural roles, and
`role="presentation"`. So the answer has to be assembled from principles, not lifted from
a pattern.

The three principles that do apply:

**(a) Focus must never be lost.** APG, *Developing a Keyboard Interface* →
"Persistence of focus" — <https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/>

> It is essential that there is always a component within the user interface that is
> active (`document.activeElement` is not null or is not the body element) and that the
> active element has a visual focus indicator. Authors need to manage events that effect
> the currently active element so focus remains visible and moves logically. For example,
> if the user closes a dialog or performs a destructive operation like deleting an item
> from a list, the active element may be hidden or removed from the DOM. If such events
> are not managed to set focus on the button that triggered the dialog or on the list
> item following the deleted item, browsers move focus to the body element, effectively
> causing a loss of focus within the user interface.

This matters more for *removing* a half-typed row than for adding one — if the row the
user is typing in gets torn down and re-rendered (which `render()`-everything
architectures like this one do routinely), focus goes to `<body>`.

**(b) When the action's context is where focus already is, do not move focus.** Same
document, "Key Assignment Conventions for Common Functions":

> **Activate an element without moving focus** when the target context of the function is
> the context that contains the focus. [...] For example, if the focus is on an option in
> a listbox and a toolbar contains buttons for moving and removing options, it is most
> beneficial to keep focus in the listbox when the user presses a key shortcut for one of
> the buttons in the toolbar. **This behavior can be particularly important for screen
> reader users because it provides confirmation of the action performed and makes
> performing multiple commands more efficient.**

**(c) Moving focus to a newly created row is legitimate — but only as the result of an
explicit action.** APG, Dialog (Modal) Pattern —
<https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/>

> When a dialog closes, focus returns to the element that invoked the dialog unless
> either: [...] The work flow design includes the following conditions that can
> occasionally make focusing a different element a more logical choice: It is very
> unlikely users need to immediately re-invoke the dialog. The task completed in the
> dialog is directly related to a subsequent step in the work flow. **For example, a grid
> has an associated toolbar with a button for adding rows. The Add Rows button opens a
> dialog that prompts for the number of rows. After the dialog closes, focus is placed in
> the first cell of the first new row.**

Note the shape of the sanctioned example: *a button was pressed*. That is the
"activating a control" case 3.2.2 explicitly exempts, not the "changing a setting" case.

**Synthesis (this part is inference, clearly labelled):** neither "move" nor "stay" is
mandated. But the combination of the 3.2.2 focus bullet, principle (b), and the F36
reasoning points one way: **when the row is created implicitly by typing, focus must stay
in the field the user is typing in.** Moving it is both a 3.2.2 change of context caused
by a setting change, and a violation of principle (b). If you want "type a name and land
in the type picker", the way to get it that all the primary sources sanction is an
explicit commit key — Enter — which is activation, not a setting change (and see Q3 on
implicit submission).

### What must be announced: less than you'd think

**SC 4.1.3 Status Messages (Level AA)** — <https://www.w3.org/TR/WCAG22/#status-messages>

> In content implemented using markup languages, status messages can be programmatically
> determined through role or properties such that they can be presented to the user by
> assistive technologies without receiving focus.

The *Understanding* document contains an example that is a near-exact structural match to
both proposal 1 and proposal 2 — Understanding SC 4.1.3, "Examples of changes that are
not status messages" — <https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html>

> After a user completes a survey question which indicates they are unhappy, a series of
> new questions are added to the page about customer satisfaction.
>
> The new inputs **do not meet the definition of status message**. They do not "provide
> information to the user on the success or results of an action, on the waiting state of
> an application, on the progress of a process or on the existence of errors," and so are
> not required to meet this success criterion.
>
> **Note**
> Creating a status message about these questions being added, or notifying the user in
> advance that content changes may take place based on the user's response, are **best
> practices but are not requirements** in this scenario.

**So: nothing is *required* to be announced when a new empty row or a newly revealed step
appears.** Announcing it is a best practice. Announcing badly is worse than not
announcing — the same document warns:

> However, there is a risk of making an application too "chatty" for a screen reader
> user. User testing should be carried out to ensure the appropriate level of feedback is
> achieved.

If you do announce, the politeness level is normatively specified. WAI-ARIA 1.2,
`aria-live` — <https://www.w3.org/TR/wai-aria-1.2/#aria-live>

> When live regions are marked as **polite**, assistive technologies SHOULD announce
> updates at the next graceful opportunity, such as at the end of speaking the current
> sentence **or when the user pauses typing**. When live regions are marked as
> **assertive**, assistive technologies SHOULD notify the user immediately. Because an
> interruption may disorient users or cause them to not complete their current task,
> authors **SHOULD NOT** use the assertive value unless the interruption is imperative.

That "or when the user pauses typing" clause is the single most useful sentence in this
whole report for proposal 2: a `aria-live="polite"` region is *specified* to defer its
announcement until the person stops typing. It is the right tool, and `assertive` is
normatively the wrong one (SHOULD NOT).

**Recommended (judgement, grounded):** `role="status"` (implicit `aria-live="polite"`,
`aria-atomic="true"` per <https://www.w3.org/TR/wai-aria-1.2/#status>) carrying a short
count-style message — "3 inputs" — rather than an event-style one. The shopping-cart
example in Understanding 4.1.3 is precisely this shape, and a count re-announces
correctly on every add and remove.

---

## Q3. Debounce / commit timing, and undoing a half-typed committed row

### The platform defines "commit" for a text field, and it is not the keystroke

HTML Living Standard §4.10.5.5 *Common event behaviors* —
<https://html.spec.whatwg.org/multipage/input.html#common-input-element-events>

> When the `input` and `change` events apply [...] the events are fired to indicate that
> the user has interacted with the control. **The `input` event fires whenever the user
> has modified the data of the control. The `change` event fires when the value is
> committed, if that makes sense for the control, or else when the control loses focus.**
> In all cases, the `input` event comes before the corresponding `change` event (if any).

And the spec's own worked example of the distinction:

> An example of a user interface involving both interactive manipulation and a commit
> action would be a Range controls that use a slider, when manipulated using a pointing
> device. While the user is dragging the control's knob, `input` events would fire
> whenever the position changed, whereas the `change` event would only fire when the user
> let go of the knob, **committing to a specific value**.

**This is the answer to "commit on first keystroke?": no.** The web platform's own
definition of committing a text value is blur (or an explicit commit action). Building
row creation on `input` puts you at odds with the platform's model of the same word.

The other platform-sanctioned commit gesture is Enter. HTML Living Standard §4.10.22.2
*Implicit submission* —
<https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#implicit-submission>

> A `form` element's **default button** is the first submit button in tree order whose
> form owner is that `form` element. If the user agent supports letting the user submit a
> form implicitly (for example, on some platforms hitting the "enter" key while a text
> control is focused implicitly submits the form), then doing so for a form, whose
> default button has activation behavior and is not disabled, must cause the user agent
> to fire a `click` event at that default button. [...] There are pages on the web that
> are only usable if there is a way to implicitly submit forms, so **user agents are
> strongly encouraged to support this**.

If the row adder is a real `<form>` with a real submit button, **Enter already commits,
for free, with full assistive-technology support, and F36's warnings do not apply**
(F36 explicitly endorses "rely on the standard form behavior of the submit button and
enter key"). This is a cheap and fully spec-backed halfway house between "press the
button" and "no button at all": keep the button, make Enter work, and the "people forget
the button" problem largely dissolves without any implicit-commit risk.

### The two first-party design systems flatly contradict each other

**GOV.UK says do not commit or validate on blur.** GOV.UK Design System, *Recover from
validation errors* → "When to tell the user about validation errors" —
<https://design-system.service.gov.uk/patterns/validation/>

> **Do not validate when the user moves away from a field.** Wait until they try to move
> to the next part of the service - usually by clicking the 'continue' or 'submit' button
> at the bottom of the page.
>
> Generally speaking, **avoid validating the information in a field before the user has
> finished entering it. This sort of validation can cause problems - especially for users
> who type more slowly.**
>
> Only add this sort of validation if your user research shows that, on balance, it solves
> more problems for users than it causes. For example, the Character count component shows
> users an error message when they go over the character limit. [...]
>
> Only add client side validation if you find a user need for it. [...] Before you add
> client side validation, consider that: it's hard to tell the user about errors in a way
> that works reliably across different browsers and assistive technologies [...]

**Apple says do exactly the opposite.** Apple HIG, *Entering data* —
<https://developer.apple.com/design/human-interface-guidelines/entering-data>

> **Dynamically validate field values.** People can get frustrated when they have to go
> back and correct mistakes after filling out a lengthy form. **When you verify values as
> soon as people enter them — and provide feedback as soon as you detect a problem — you
> give them the opportunity to correct errors right away.**

Same page, on gating progress — which is directly relevant to proposal 1:

> When data entry is necessary, make sure people understand that they must provide the
> required data before they can proceed. For example, if you include a Next or Continue
> button after a set of text fields, **make the button available only after people enter
> the data you require.**

**Both are primary. Neither is wrong.** The divergence is contextual, and the context
differs in a way that matters here: GOV.UK is writing for one-question-per-page,
server-rendered, no-JavaScript-guaranteed public services completed once; Apple is
writing for resident applications used repeatedly by the same person. The command page is
much closer to the Apple context — a repeat-use authoring tool with guaranteed
client-side script — which is a legitimate reason to weight Apple here, but it is a
judgement, and it should be recorded as one.

### On debounce duration specifically: no primary source exists

**No primary source in any of the four families specifies a debounce interval, a
keystroke threshold, or a pause duration for implicit commit.** Not WCAG, not the APG,
not the HTML standard, not GOV.UK, not Apple. Every number you have ever seen quoted for
this (300 ms, 500 ms, "one second") traces to blog posts and practitioner folklore, not
to a specification.

The one *adjacent* normative constraint worth knowing: if you commit on a timer, you have
created a time limit, and **SC 2.2.1 Timing Adjustable (Level A)**
(<https://www.w3.org/TR/WCAG22/#timing-adjustable>) becomes live —

> For each time limit that is set by the content, at least one of the following is true:
> **Turn off** The user is allowed to turn off the time limit before encountering it; or
> **Adjust** The user is allowed to adjust the time limit [...] **Extend** The user is
> warned before time expires and given at least 20 seconds to extend the time limit [...]
> **Essential Exception** The time limit is essential and extending it would invalidate
> the activity [...]

A short debounce almost certainly falls under the "Essential Exception" (the pause *is*
the signal), and I found no WCAG technique or failure treating input debounce as a 2.2.1
time limit. **But note the shape of the risk:** a commit that fires on a timer while
someone is still deciding what to type is a time limit imposed on a cognitive task, and
it is exactly the population GOV.UK names — "especially for users who type more slowly."
A commit on *blur* or on *Enter* has no timer and dodges 2.2.1 entirely. That asymmetry
is a real argument for blur/Enter over pause-detection.

### Undoing or abandoning a half-typed committed row

WCAG's "Reversible" is the relevant normative hook, though the criteria that carry it are
scoped narrowly. **SC 3.3.4 Error Prevention (Legal, Financial, Data) (Level AA)** —
<https://www.w3.org/TR/WCAG22/#error-prevention-legal-financial-data>

> For web pages that cause legal commitments or financial transactions for the user to
> occur, **that modify or delete user-controllable data in data storage systems**, or
> that submit user test responses, at least one of the following is true:
>
> **Reversible** Submissions are reversible.
> **Checked** Data entered by the user is checked for input errors and the user is
> provided an opportunity to correct them.
> **Confirmed** A mechanism is available for reviewing, confirming, and correcting
> information before finalizing the submission.

**SC 3.3.6 Error Prevention (All) (Level AAA)** —
<https://www.w3.org/TR/WCAG22/#error-prevention-all> — widens it to everything:

> For web pages that require the user to submit information, at least one of the
> following is true: **Reversible** Submissions are reversible. **Checked** [...]
> **Confirmed** [...]

Reading this against the proposal: the current design satisfies 3.3.4 via *Confirmed*
(the "+ Add input" button is the review-before-finalize step). **Removing that button
removes the Confirmed leg, so the design must then satisfy Reversible or Checked
instead.** That is the cleanest way to state the obligation proposal 2 incurs — it is not
that implicit commit is forbidden, it is that it moves you off one leg of the criterion
and onto another, and you have to actually land on that other leg.

Whether an in-memory model edit counts as "modify [...] user-controllable data in data
storage systems" for 3.3.4 purposes is arguable for a playground that keeps its model
client-side. 3.3.6 has no such qualifier and clearly covers it, but 3.3.6 is Level AAA.

Apple is the only first-party source with substantive undo guidance — HIG, *Undo and
redo* — <https://developer.apple.com/design/human-interface-guidelines/undo-and-redo>

> **Let people undo multiple times.** Avoid placing unnecessary limits on the number of
> times people can undo or redo. People generally expect to undo every action they've
> performed since taking a logical step like opening a document or saving their work.

> **Show the results of an undo or redo.** Sometimes, the most recent action that people
> want to undo affects content or an area that's no longer visible. In cases like this,
> it's crucial to highlight the result of each undo and redo to keep people from thinking
> that the action had no effect, which can lead them to perform it repeatedly.

> **Help people predict the results of undo and redo as much as possible.** [...] If you
> provide undo and redo menu items, you can modify the menu item labels to identify the
> result. For example, a document-based app might use menu item labels like Undo Typing or
> Redo Bold.

Related, and cheaper than undo — HIG, *Feedback*
(<https://developer.apple.com/design/human-interface-guidelines/feedback>):

> **Warn people when they initiate a task that can cause data loss that's unexpected and
> irreversible.** In contrast, **don't warn people when data loss is the expected result
> of their action.**

**Judgement call, flagged:** there is **no primary-source guidance on the specific case of
abandoning a half-typed row that has already been committed.** The design space
(auto-discard an empty-named row on blur; keep it and mark it incomplete; full undo stack)
is not addressed by any source found. What the sources *do* constrain is: whichever you
pick, don't lose focus when the row is torn down (APG persistence of focus), and don't
make the row's removal need a confirmation dialog if removal is the obviously expected
outcome (HIG *Feedback*).

---

## Q4. What GOV.UK actually concludes about splitting a long form into steps

### The conclusion

GOV.UK Service Manual, *Form structure* → "Start with one thing per page" —
<https://www.gov.uk/service-manual/design/form-structure>

> **Start with one thing per page**
>
> Start by splitting the form across multiple pages with each page containing just one
> thing, for example:
>
> - one piece of information you're telling a user
> - one decision they have to make
> - one question they have to answer
>
> **User research will tell you when you can merge pages together.** For example, if
> you're designing an internal service for government users who need to repeat and switch
> between tasks quickly.
>
> Starting with one thing on a page helps people to:
>
> - understand what you're asking them to do
> - focus on the specific question and its answer
> - find their way through an unfamiliar process
> - use the service on a mobile device
> - recover easily from form errors
>
> It also helps you to:
>
> - save a user's answers automatically as they go
> - capture analytics about each question
> - handle branching questions and loops

The same carve-out appears verbatim in the Design System's *Question pages* pattern —
<https://design-system.service.gov.uk/patterns/question-pages/>

> Sometimes it makes sense to group a number of related questions on the same page.
> **User research will tell you when you can group pages together.** For example, if
> you're designing an internal service for government users who need to repeat and switch
> between tasks quickly.

**Read that carve-out carefully — it describes this tool.** The command page is an
internal authoring surface for people who repeat and switch between tasks quickly. GOV.UK
names that exact population as the case where grouping is appropriate. Its own guidance
therefore does *not* straightforwardly recommend a wizard here; it says "start" with one
thing per page and let research tell you when to merge, and it pre-identifies the class of
service where merging is likely right.

Note also that "one thing per page" is a *starting position*, not a conclusion, and every
listed benefit is a claim, not a measurement. GOV.UK does not publish numbers behind these
bullets.

W3C WAI's Forms Tutorial reaches a compatible conclusion with a similar hedge —
*Multi-page Forms* — <https://www.w3.org/WAI/tutorials/forms/multi-page/>

> **Where possible**, divide long forms into multiple smaller forms that constitute a
> series of logical steps or stages. This helps make long forms less daunting and easier
> to understand, particularly for people who are less experienced using computers or who
> have various cognitive disabilities.
>
> The following basic principles should apply for multi-step forms:
>
> - Repeat overall instructions on every page.
> - **Split the form up according to its logical groups of controls.**
> - **Make it easy to recognize and to skip optional stages.** For example, highlight
>   optional steps in the main heading of the web page and provide an option to skip.
> - If possible, don't set a time limit to fill out the form. [...]
>
> If possible, the first step of a form should explain how many steps will follow. Each
> step should inform the user about the progress they are making.

That third bullet is a direct hit on the proposal's "rules are set **or explicitly
skipped**" — skipping an optional stage must be recognisable and available, which is what
the proposal already describes. Good.

WAI also specifies *where* progress goes, and it is not only a visual stepper:

> The `<title>` element is the first item read by many people, such as screen reader
> users. Changing the title of the page to include the progress gives immediate feedback.
> **This information should precede other information provided in the title** [...]
> `<title>Step 2 of 4: Shipping Address – Complete Purchase – Galactic Teddy Bears Shop</title>`

In a single-page app with no page navigation, the equivalent obligation lands on the
heading and on SC 2.4.3 Focus Order (<https://www.w3.org/TR/WCAG22/#focus-order>) —

> If a web page can be navigated sequentially and the navigation sequences affect meaning
> or operation, focusable components receive focus in an order that preserves meaning and
> operability.

### The documented costs

GOV.UK does document costs, but they are scattered across pattern pages rather than
collected. The ones I could source:

**Back/forward.** *Question pages* — <https://design-system.service.gov.uk/patterns/question-pages/>

> **Back link**
> Some users do not trust browser back buttons when they're entering data. Always include
> a Back link component at the top of question pages to reassure them it's possible to go
> back and change previous answers.
>
> However, **do not break the browser back button**. Make sure it takes users to the
> previous page they were on, **in the state they last saw it**.
>
> An exception to this is when the user has performed an action they should only do once,
> like make a payment or complete an application. The browser back button should still
> work, but show the user a sensible message rather than let them perform the action
> again.

This is the single most expensive line item for proposal 1 in a client-rendered SPA. "Do
not break the browser back button" and "in the state they last saw it" means a wizard
needs real history entries and restorable step state. `app/index.html` currently drives
views from a `state` object and a `render()` call; a step sequence that does not push
history will violate the guidance the moment a user reaches for Back.

**Redundant entry — now normative.** *Question pages*:

> Make sure to **only ask for a piece of information once within a single journey**.
> Whenever possible, do not ask a user to re-enter information they've already provided.
> If the same type of information is needed more than once, make it easier to reuse
> previously entered answers through one of these methods: pre-populating the relevant
> fields; showing carried-forward responses as an option for the user to select.

This is not just GOV.UK opinion — WCAG 2.2 added it. **SC 3.3.7 Redundant Entry (Level
A)** — <https://www.w3.org/TR/WCAG22/#redundant-entry>

> Information previously entered by or provided to the user that is required to be entered
> again **in the same process** is either: auto-populated, or available for the user to
> select.
>
> Except when: re-entering the information is essential, the information is required to
> ensure the security of the content, or previously entered information is no longer valid.

Splitting a page into steps creates "the same process" where there wasn't one, and thereby
brings 3.3.7 into scope where it previously was not. Relevant here because the command
page's later steps (emits, changes) reference names established in earlier steps
(trigger's payload properties) — those must be offered for selection, not retyped.

**Resuming.** *Complete multiple tasks* (the renamed Task list pattern) —
<https://design-system.service.gov.uk/patterns/complete-multiple-tasks/>

> **Only use a complete multiple tasks page for longer transactions involving multiple
> tasks that users may need to complete over a number of sessions.**
>
> **Try to simplify the transaction before you use a complete multiple tasks page. If
> you're able to reduce the number of tasks or steps involved, you might not need one.**
>
> You should show a complete multiple tasks page: at the start of the transaction; at the
> start of each returning session.

Read as a cost statement: the task-list machinery is the price of a resumable multi-step
flow, and GOV.UK's first instruction is to try to avoid needing it.

**Validation timing.** Already quoted in Q3 — "Wait until they try to move to the next
part of the service." A wizard makes each "Continue" a validation boundary, which is a
benefit (errors surface near their cause) but also means the boundaries must be
meaningful. A six-step command definition where step 4 invalidates step 2 is worse than a
single page, because the user has to travel back.

**Where GOV.UK is honest about not knowing.** Task list component, "Known issues and
gaps" — <https://design-system.service.gov.uk/components/task-list/>

> While this new component is based on user research from the task list pattern, we still
> need to carry out user testing with this new component. In particular, we would like to
> test the following assumptions: the benefits of linking the whole task row outweigh the
> risks of accidental clicking [...]

And *Recover from validation errors*, "Research on this pattern":

> This approach to validation has been used on a number of services over an extended
> period of time. [...] But we'd like to expand the guidance, and **we're especially
> interested in hearing from teams whose research has identified a need to use client side
> validation.**

That second one is worth internalising: GOV.UK's anti-client-side-validation stance is
explicitly flagged by its own authors as under-researched.

### The end-of-flow piece

If proposal 1 goes ahead, the summary step is a documented pattern. *Check answers* —
<https://design-system.service.gov.uk/patterns/check-answers/>

> Show a single check answers page immediately before the confirmation screen for small to
> medium-sized transactions. When designing a very large transaction with multiple
> sections, it may help to include a check answers pages at the end of each section.
>
> Check answers pages help to: increase users' confidence as they can clearly see that
> they have completed all the sections and that their data has been captured; **reduce
> error rates as users are given a second chance to notice and correct errors before
> submitting data**.

Note the structural irony worth surfacing in the design discussion: **the current
all-six-steps-at-once page already *is* a check-answers view.** Splitting it into a wizard
means building the summary back at the end. That is not an argument against the split, but
it is a cost that belongs on the ledger.

---

## Q5. Inline / nested creation, and returning the user to where they were

### What is primary, and it is thinner than you'd like

**There is no ARIA APG pattern for "create a new X from inside a picker."** The closest
sanctioned mechanism is the combobox + dialog composition, and the APG's normative-ish
requirement is about the return trip, not the creation.

APG, Dialog (Modal) — <https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/>

> **When a dialog closes, focus returns to the element that invoked the dialog** unless
> either:
> - The invoking element no longer exists. Then, focus is set on another element that
>   provides logical work flow.
> - The work flow design includes the following conditions that can occasionally make
>   focusing a different element a more logical choice: It is very unlikely users need to
>   immediately re-invoke the dialog. The task completed in the dialog is directly related
>   to a subsequent step in the work flow.

> It is strongly recommended that the tab sequence of all dialogs include a visible
> element with role `button` that closes the dialog, such as a close icon or cancel
> button.

**The HTML standard makes focus restoration normative for `<dialog>`.** HTML Living
Standard, `close the dialog` steps —
<https://html.spec.whatwg.org/multipage/interactive-elements.html#close-the-dialog>

> If *subject*'s **previously focused element** is not null: Let *element* be *subject*'s
> previously focused element. Set *subject*'s previously focused element to null. If
> *subject*'s node document's focused area of the document's DOM anchor is a
> shadow-including inclusive descendant of *subject*, or *wasModal* is true, then **run
> the focusing steps for *element***; the viewport should not be scrolled by doing this
> step.

Which is to say: **if inline creation is implemented with a native `<dialog>` opened via
`showModal()`, "return the user to exactly where they were" is free and guaranteed by the
browser.** The `app` codebase currently builds inline creation with an `inlineForm()` and
a `state.newFeature` flag (`app/index.html:3253`), re-rendering in place — which achieves
"never navigate away" but gets no focus restoration from the platform and must implement
it by hand.

**Apple explicitly warns against the nested case.** HIG, *Sheets* —
<https://developer.apple.com/design/human-interface-guidelines/sheets>

> **Display only one sheet at a time from the main interface.** When people close a sheet,
> they expect to return to the parent view or window. **If closing a sheet takes people
> back to another sheet, they can lose track of where they are in your app.** If something
> people do within a sheet results in another sheet appearing, close the first sheet
> before displaying the new one. If necessary, you can display the first sheet again after
> people dismiss the second one.

> **Provide an alternative to the Done button.** If you provide a Done button, always pair
> it with a Cancel button to give people a clear way to dismiss the sheet without
> confirming or saving their changes, or a Back button to move to a previous step in the
> sheet. Relying solely on the Done button implies that completing the task is the only
> way to exit the sheet, which can feel restrictive or misleading.

> **For complex or prolonged user flows, consider alternatives to sheets.**

This is the one place where the proposal as stated collides with primary guidance.
"Create an entity inline, and while creating it discover you need a property, so create
that inline too" is precisely the nested-sheet case Apple says loses people. If inline
creation is modal, keep it one level deep; if it needs to go deeper, it argues for
non-modal inline editing (which is what `inlineForm()` already does) rather than stacked
dialogs.

**Non-modal inline creation is sanctioned, but shifts the burden to focus order.** SC
2.4.3 Focus Order (Level A) — <https://www.w3.org/TR/WCAG22/#focus-order> — quoted above,
plus its Intent — <https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html>

> The intent of this success criterion is to ensure that when users navigate sequentially
> through content, they encounter information in an order that is consistent with the
> meaning of the content and can be operated from the keyboard. **This reduces confusion
> by letting users form a consistent mental model of the content.** There may be different
> orders that reflect logical relationships in the content.

Combined with APG's "Persistence of focus" (quoted in Q2), the requirement for a
non-modal inline creator is: the creator appears **in DOM order at the point of
invocation**, and when it closes, focus goes back to the invoking control — the same
contract `<dialog>` gives for free.

And 3.3.7 Redundant Entry (quoted in Q4) applies again: if the user has already typed
"Course" as the entity name in the picker's filter, the inline creator should arrive
pre-filled with it rather than asking again.

**Judgement call, flagged:** **no primary source found describes the state-preservation
contract for the *parent* form during inline creation** — whether the half-finished
command must survive, whether it should be visibly present behind the creator, whether
the newly created entity should be auto-selected on return. Every source found addresses
only focus, not data. The auto-selection question in particular ("I created it, so
obviously I want it") is universal practice and entirely unsourced. Treat it as a design
decision to be tested, not as a settled pattern.

---

## Per-proposal bottom line

### Proposal 1 — progressive disclosure / wizard

- **Permitted.** WCAG 3.2.2's calendar example explicitly blesses revealing fields based
  on an earlier answer: "Because only parts of the entry change and the overall structure
  remains the same, the basic context remains for the user."
- **Nothing must be announced** when a step appears (Understanding 4.1.3, survey
  example) — announcing is a documented best practice, not a requirement.
- **GOV.UK's "one thing per page" is a starting position with an explicit carve-out that
  names this kind of tool** (internal, repeat use, task-switching). Do not cite GOV.UK as
  straightforwardly endorsing the wizard; it does not.
- **Documented costs to budget:** browser Back must work and restore state; 3.3.7
  Redundant Entry comes into scope; optional steps must be skippable and visibly so
  (W3C WAI); a summary/check-answers view must be rebuilt at the end, because the current
  page already is one.
- The proposal's specific claim — "success event appears only after rules are set or
  explicitly skipped" — matches WAI's "make it easy to recognize and to skip optional
  stages" well.

### Proposal 2 — implicit commit on naming

- **Creating the row is a change of content, not context: 3.2.2 is automatically met** —
  *provided focus does not move*.
- **Moving focus into the new row on typing is a Level A 3.2.2 failure** unless the user
  is warned in advance, because focus is enumerated in the definition of change of
  context.
- **The platform's own definition of "commit" for a text control is blur, not keystroke**
  (HTML §4.10.5.5). Commit-on-keystroke fights the platform's vocabulary.
- **Enter is free.** HTML implicit submission gives a spec-backed, AT-supported explicit
  commit with no button press, and F36 specifically recommends relying on it. Wiring Enter
  to the existing adder is a lower-risk fix for "people forget the button" than removing
  the button.
- **Removing the button removes the "Confirmed" leg of 3.3.4/3.3.6.** The design must
  then land on "Reversible" or "Checked" instead.
- **GOV.UK and Apple flatly contradict each other** on validating/committing as you type.
  Both are primary. Weighting Apple is defensible given the context (repeat-use internal
  tool with guaranteed script) but is a judgement, not a citation.
- **Announce with `role="status"` / `aria-live="polite"`, never `assertive`** (ARIA 1.2
  SHOULD NOT). Polite is specified to wait for a pause in typing — exactly the behaviour
  wanted.
- **No primary source specifies a debounce duration.** If you commit on a pause timer you
  have created a time limit that lands in 2.2.1's neighbourhood; blur and Enter have no
  timer and sidestep it.

### Proposal 3 — inline creation without losing scope

- **Return-to-place is the one hard requirement, and it is well-sourced.** APG: focus
  returns to the invoking element. HTML: `<dialog>` does it normatively for you.
- **Keep it one level deep.** Apple HIG explicitly warns that closing one sheet into
  another loses people — which is the exact "entity, then entity property" case in the
  proposal.
- **Always offer Cancel, not only Done** (Apple HIG, Sheets).
- **Pre-fill from what the user already typed** (3.3.7 Redundant Entry, Level A).
- **Data-state preservation and auto-selection on return are unsourced.** Judgement call.

---

## Gaps: where there is no primary source

Recording these honestly, because each one is a place where the design discussion should
proceed on reasoning and testing rather than on an appeal to authority.

1. **No debounce/commit-timing interval anywhere.** No spec or first-party design system
   gives a number, a keystroke count, or a pause threshold for implicit commit. Every
   commonly cited figure is practitioner folklore.
2. **No ARIA APG pattern for multi-step forms, wizards, or steppers.** The APG's 30
   patterns and 7 practices contain nothing on this; it covers widgets, not flows.
3. **No APG pattern for a dynamically added form row.** The `feed` pattern is for
   scroll-loaded `article` content and is a structure, not a widget — it does not transfer
   (<https://www.w3.org/WAI/ARIA/apg/patterns/feed/>). `grid` addresses navigation within
   tabular data, not implicit row creation.
4. **No primary guidance on abandoning or undoing a half-typed, already-committed row.**
   Whether to auto-discard an unnamed row on blur, mark it incomplete, or provide undo is
   unaddressed by every source consulted.
5. **No primary guidance on parent-form state during inline creation**, nor on
   auto-selecting the newly created item on return. Sources cover focus restoration only.
6. **Material Design 3 could not be obtained as a primary source.** `m3.material.io`
   serves a JavaScript-rendered shell with no static HTML, no public content API
   (`/api/page` returns 404), and `m2.material.io` now serves the same shell. Its guidance
   is therefore absent from this report rather than summarised at second hand. If it
   matters to the decision, it needs retrieving with a JS-capable browser.
7. **GOV.UK publishes no quantitative research behind "one thing per page."** The benefit
   list is a claim list. Its own Task list component page and validation pattern both
   openly flag untested assumptions and gaps in their evidence.
8. **The direct GOV.UK vs Apple contradiction on as-you-type validation is unresolved by
   any higher authority.** WCAG does not adjudicate it — 3.3.1 requires that detected
   errors be identified and described in text
   (<https://www.w3.org/TR/WCAG22/#error-identification>), but says nothing about *when*
   detection should happen.

---

## Sources

Normative:

- WCAG 2.2 (W3C Recommendation) — <https://www.w3.org/TR/WCAG22/>
  (3.2.1, 3.2.2, 3.2.5, 2.2.1, 2.4.3, 3.3.1, 3.3.2, 3.3.4, 3.3.6, 3.3.7, 4.1.3, and the
  glossary definition of *changes of context*)
- WAI-ARIA 1.2 (W3C Recommendation) — <https://www.w3.org/TR/wai-aria-1.2/>
  (`aria-live`, `aria-modal`, `role="status"`)
- HTML Living Standard (WHATWG) —
  <https://html.spec.whatwg.org/multipage/input.html#common-input-element-events>,
  <https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#implicit-submission>,
  <https://html.spec.whatwg.org/multipage/interactive-elements.html#close-the-dialog>

First-party informative (W3C/WAI):

- Understanding SC 3.2.2 On Input — <https://www.w3.org/WAI/WCAG22/Understanding/on-input.html>
- Understanding SC 4.1.3 Status Messages — <https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html>
- Understanding SC 2.4.3 Focus Order — <https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html>
- Failure F36 — <https://www.w3.org/WAI/WCAG22/Techniques/failures/F36>
- ARIA APG patterns index — <https://www.w3.org/WAI/ARIA/apg/patterns/>
- ARIA APG practices index — <https://www.w3.org/WAI/ARIA/apg/practices/>
- ARIA APG — Dialog (Modal) — <https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/>
- ARIA APG — Disclosure (Show/Hide) — <https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/>
- ARIA APG — Feed — <https://www.w3.org/WAI/ARIA/apg/patterns/feed/>
- ARIA APG — Developing a Keyboard Interface — <https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/>
- W3C WAI Forms Tutorial — Multi-page Forms — <https://www.w3.org/WAI/tutorials/forms/multi-page/>

First-party design systems:

- GOV.UK Service Manual — Form structure — <https://www.gov.uk/service-manual/design/form-structure>
- GOV.UK Design System — Question pages — <https://design-system.service.gov.uk/patterns/question-pages/>
- GOV.UK Design System — Recover from validation errors — <https://design-system.service.gov.uk/patterns/validation/>
- GOV.UK Design System — Complete multiple tasks — <https://design-system.service.gov.uk/patterns/complete-multiple-tasks/>
- GOV.UK Design System — Task list component — <https://design-system.service.gov.uk/components/task-list/>
- GOV.UK Design System — Check answers — <https://design-system.service.gov.uk/patterns/check-answers/>
- Apple HIG — Entering data — <https://developer.apple.com/design/human-interface-guidelines/entering-data>
- Apple HIG — Undo and redo — <https://developer.apple.com/design/human-interface-guidelines/undo-and-redo>
- Apple HIG — Sheets — <https://developer.apple.com/design/human-interface-guidelines/sheets>
- Apple HIG — Feedback — <https://developer.apple.com/design/human-interface-guidelines/feedback>

Attempted and unavailable:

- Material Design 3 — <https://m3.material.io/> (JS-rendered; no static content retrievable)
