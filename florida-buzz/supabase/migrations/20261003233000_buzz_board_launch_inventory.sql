-- Phase 4 controlled launch inventory for florida-buzz-staging only.
-- Production application requires separate explicit approval.

do $$
declare
  v_admin_id uuid;
begin
  select user_id into v_admin_id
  from public.profiles
  where role = 'admin' and status = 'active'
  order by created_at
  limit 1;

  if v_admin_id is null then
    raise exception 'an active Florida Buzz admin profile is required';
  end if;

  insert into public.discussions (
    slug, question, context, category, topic, source_type, status,
    moderation_status, created_by, starter_label
  )
  select
    launch.slug, launch.question, launch.context, launch.category, launch.topic,
    'florida_buzz', 'published', 'published', v_admin_id, 'Florida Buzz'
  from (values
    ('disney-attraction-wait-not-worth-it', 'Which Disney World attraction gets a wait time its actual experience simply does not justify?', 'Consider the full experience—not just ride length—including the queue, reliability, atmosphere, and what you give up while waiting.', 'disney', 'Attraction waits'),
    ('when-disney-vacation-price-goes-too-far', 'At what total price does a Disney vacation stop feeling magical and start feeling financially irresponsible?', 'The line is different for every family. Think about the complete trip cost and what else that money could reasonably buy.', 'disney', 'Vacation value'),
    ('retired-disney-experience-worth-bringing-back', 'If Disney could restore one retired experience, what current experience would you trade for it?', 'Nostalgia is easy when nothing has to make room for it. The tradeoff is what makes the answer interesting.', 'disney', 'Nostalgia'),
    ('rope-drop-or-slow-disney-morning', 'Do the best Disney days start at rope drop, or are guests sacrificing too much sleep for shorter lines?', 'Compare what an early start saves in line time with what it costs in energy later in the day.', 'disney', 'Park strategy'),
    ('what-epcot-should-protect-most', 'EPCOT has carried several identities. Which should guide its next era: discovery, world culture, festivals, or headline attractions?', 'The park can contain all four, but priorities reveal what guests believe EPCOT is supposed to be.', 'disney', 'EPCOT identity'),
    ('animal-kingdom-half-day-reputation', 'Animal Kingdom still gets labeled a half-day park. Is that reputation earned, or does it reveal how people tour it?', 'A ride checklist and a slower day built around trails, animals, atmosphere, and shows produce very different judgments.', 'disney', 'Animal Kingdom'),
    ('disney-transportation-tradeoff', 'Would you rather accept slower Disney transportation or pay more for control over every trip between parks and hotels?', 'Buses, boats, gondolas, monorails, rideshares, and rental cars each trade convenience for cost or flexibility.', 'disney', 'Transportation'),
    ('one-disney-park-to-skip', 'If one Disney World park had to come off your next itinerary, which would it be—and what would earn its place back?', 'The second half matters: identify the experience or change that would reverse your decision.', 'disney', 'Park priorities'),
    ('disney-split-stay-worth-moving', 'Is a Disney split stay worth changing hotels mid-trip, or does the move erase the benefit?', 'Trying two resort areas can change transportation and atmosphere, but packing twice has a real cost.', 'disney', 'Split stays'),
    ('when-disney-resort-premium-is-worth-paying', 'When does staying at a Disney resort justify the premium, and when is an off-site hotel the smarter choice?', 'Location, transportation, room quality, trip pace, and budget can point to very different answers.', 'disney', 'Resort value'),
    ('hollywood-studios-complete-park-day', 'How would you change Hollywood Studios so it feels like a complete, unhurried park day?', 'Think beyond adding a single ride: capacity, shade, entertainment, dining, and places to slow down all count.', 'disney', 'Hollywood Studios'),
    ('disney-dining-planning-too-much-work', 'Has planning Disney dining become part of the fun—or homework that gets in the way of the vacation?', 'Advance choices can protect a must-do meal, but they can also lock a family into a schedule months before hunger arrives.', 'disney', 'Dining planning'),
    ('when-disney-park-hopping-wastes-time', 'At what point does park hopping add freedom—and at what point does it simply waste too much vacation time?', 'The answer changes with trip length, transportation, evening plans, and how much a group values spontaneity.', 'disney', 'Park hopping'),
    ('paid-line-skipping-value-at-disney', 'Paid line-skipping can save hours at Disney. What makes it a smart purchase instead of a frustrating extra charge?', 'Consider crowd level, group size, trip length, attraction priorities, and whether the saved time actually improves the day.', 'disney', 'Line skipping'),
    ('disney-pool-day-versus-extra-park-day', 'When does a real pool or rest day improve a Disney trip enough to justify giving up park time?', 'An extra park day looks valuable on paper. A rested family may remember the trip very differently.', 'disney', 'Family pacing'),
    ('who-disney-character-dining-is-for', 'Character dining costs more than a meal. Who is it genuinely worth it for—and who should skip it?', 'Food, character time, convenience, age, and the value of a guaranteed interaction all belong in the calculation.', 'disney', 'Character dining'),
    ('best-disney-rain-day-strategy', 'A rainy Disney day can clear crowds or derail a plan. What separates a great rain strategy from a miserable one?', 'Timing, footwear, indoor attractions, expectations, and knowing when to stop can matter more than the forecast itself.', 'disney', 'Weather strategy'),
    ('disney-queue-better-than-ride', 'Which Disney queue tells a better story than the attraction waiting at the end of it?', null, 'disney', 'Queue design'),
    ('what-universal-does-better-than-disney', 'Where does Universal Orlando outperform Disney in ways Disney fans are reluctant to admit?', 'Compare the guest experience honestly—attractions, hotels, transportation, food, planning, and value are all fair game.', 'universal', 'Disney comparison'),
    ('universal-screen-ride-criticism', 'Is Universal still too dependent on screens and simulators, or has that criticism become outdated?', 'The strongest answer should distinguish between technology used as a shortcut and technology used to create something physical rides cannot.', 'universal', 'Screens and simulators'),
    ('islands-of-adventure-complete-lineup', 'Does Islands of Adventure have the strongest attraction lineup in Orlando—or too many weak gaps between its headliners?', 'Judge the whole park day, not only its best-known rides.', 'universal', 'Islands of Adventure'),
    ('universal-express-pass-price-limit', 'At what price does Universal Express stop buying convenience and start feeling like a second admission ticket?', 'Crowds, trip length, repeat access, and the value of certainty all change the answer.', 'universal', 'Express Pass value'),
    ('universal-theming-versus-ride-quality', 'When a Universal land looks incredible, how much can that make up for attractions you do not want to repeat?', 'Immersion and repeatable ride quality are both expensive promises. Which one carries more of a return visit?', 'universal', 'Themed lands'),
    ('universal-resort-proximity-versus-room', 'Would you choose a simpler Universal hotel with effortless park access or a better room that adds transportation time?', null, 'universal', 'Resort convenience'),
    ('universal-trip-for-younger-families', 'What does Universal need to offer more consistently for families whose children are not ready for major thrill rides?', 'Consider attraction mix, play space, shows, pacing, and whether the whole family can share enough of the day.', 'universal', 'Families'),
    ('citywalk-or-in-park-dining', 'Does leaving a Universal park for CityWalk improve a meal—or interrupt the day more than it is worth?', null, 'universal', 'Dining'),
    ('universal-park-to-park-pace', 'How do you use park-to-park access without turning a Universal day into a rush between headliners?', 'The goal is not a record ride count; it is a plan that preserves both flexibility and a sense of place.', 'universal', 'Park strategy'),
    ('when-epic-universe-becomes-trip-anchor', 'What must Epic Universe deliver consistently before it becomes the park you build an entire Universal trip around?', 'A spectacular first visit and a dependable vacation anchor are not necessarily the same thing.', 'universal', 'Epic Universe'),
    ('florida-cruise-port-convenience', 'How much should an easy Florida embarkation port influence the cruise you book?', 'Parking, hotels, traffic, terminal flow, and the trip home can shape a vacation before and after anyone boards the ship.', 'cruises', 'Embarkation ports'),
    ('short-premium-or-longer-budget-cruise', 'Would you choose a shorter cruise on a premium ship or more nights on a less exciting one—and why?', 'Compare the value of time away with the quality of the ship, dining, service, and ports.', 'cruises', 'Cruise value'),
    ('private-destination-or-local-port-day', 'What makes a better cruise day: a polished private destination or a port where you experience a real local place?', 'Convenience and predictability compete with discovery, culture, and the possibility of a less controlled day.', 'cruises', 'Port experiences'),
    ('cruise-line-loyalty-versus-itinerary', 'When should loyalty to a cruise line lose to a better itinerary or ship?', 'Status perks and familiarity are valuable, but they can quietly narrow the trips a traveler considers.', 'cruises', 'Cruise loyalty'),
    ('florida-trip-too-much-driving', 'Which Florida itinerary looks reasonable on a map but turns into far too much driving in real life?', 'Florida distances, traffic, parking, and the energy required for each stop can make an ambitious route feel very different on the road.', 'florida-life', 'Road-trip planning'),
    ('florida-beach-town-charm-versus-access', 'How much inconvenience will you tolerate for a Florida beach town that still feels distinctive?', 'Parking, price, crowds, walkability, and local character rarely point toward the same destination.', 'florida-life', 'Beach towns'),
    ('florida-tourist-attraction-locals-defend', 'Which Florida attraction do locals dismiss too quickly, and what makes it worth defending?', 'Skip the automatic tourist-trap label. Make the case for the experience, place, or tradition that earns a second look.', 'florida-life', 'Florida attractions'),
    ('florida-experience-needs-more-than-day-trip', 'Which Florida experience deserves more than a day trip to understand properly?', null, 'florida-life', 'Florida destinations')
  ) as launch(slug, question, context, category, topic)
  on conflict (slug) do nothing;
end;
$$;
