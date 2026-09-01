---
"@nerima-games/mc-compose": patch
---

Verify the bow shot against the game physics rather than a fixed landing box

The projectile test asserted an absolute landing position, which only holds for the charge it
meant to produce — and it produced that charge by holding a button for a wall-clock duration
across a latency-bound channel, so on a slow runner the hold ran long, the shot overcharged, and
the arrow overshot the box. Imprecise input, precise assertion.

It now checks the flight against the game own physics instead. Two snapshots of the same
projectile in flight are observed, and the same integration functions the application calls are
replayed forward between them for the elapsed simulated time actually reported. The test never
needs to know what charge was achieved, so the timing imprecision has nothing to act on.

The projectile snapshot gains the launch velocity, which the record already carried and simply
did not expose.

The tolerance is measured rather than chosen. A derivation from step-schedule sensitivity alone
predicts near zero, yet repeated runs against known-good code show a consistent small gap: a fast
arrow crosses the target face in well under a millisecond, so tiny differences in when that
crossing registers scale by impact speed. The floor is the measured maximum doubled, and the
command that reproduces the measurement is recorded beside it.

Validated in both directions. Substituting a different gravity profile makes it fail reliably,
by a margin well outside tolerance. Doubling the integration step does NOT make it fail, because
flight time is taken from the reported simulated age, which inflates in step — so this test
covers integration fidelity for a given amount of simulated time, and the sibling stall-injection
test covers the rate at which simulated time advances. Each one names what it does not see.
