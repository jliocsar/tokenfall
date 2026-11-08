# Tokenfall

Tokenfall is an isometric idle RPG that shows the Claude agents running in Herdr as heroes in a fantasy world. It gives one person a glanceable overview of who's working, who's finished and who needs them.

## Language

### The real world

**Agent**:
One Claude session running in a Herdr pane. A resumed session is the same Agent; a cleared one is a new Agent.
_Avoid_: Bot, worker, instance

**Subagent**:
A helper an Agent starts inside its own session, including workflow agents. A separate Claude session is always an Agent, even when it's on a team.

**Workspace**:
Herdr's top-level grouping of terminals.

**Repo**:
The code repository an Agent works in. Worktrees of one repository count as one Repo.

**Machine**:
The computer an Agent runs on. Only the local one for now.

### Characters

**Hero**:
The in-game character standing for one Agent, with a name, a portrait, a Personality and a Class. It lives as long as its Agent's session.
_Avoid_: Villager, character, unit

**Stranger**:
A hooded figure standing for an Agent whose session isn't known yet. It has no name, Personality or Level, and becomes a Hero once the session is known.
_Avoid_: Unknown hero, placeholder

**Personality**:
A Hero's randomly rolled temperament, which decides its Class and the voice of its Narration.
_Avoid_: Mood, trait

**Character Sheet**:
The full view of one Hero: portrait, name, Title, Class, Personality, Level, Experience, Quest and its terminal.
_Avoid_: Details, profile, inspector

**Class**:
A Hero's fighting role, like Mage or Knight, which decides how it looks.
_Avoid_: Job, role, type

**Title**:
The epithet after a Hero's name, taken from its Agent's Herdr name, as in "Aldric the Reviewer".
_Avoid_: Nickname, label

**Lead**:
The Hero leading a team Party, marked with a crown.
_Avoid_: Leader, captain, boss

**Guild**:
All the Heroes working in one Repo.
_Avoid_: Faction, clan

**Wanderers**:
The Guild of Heroes whose Agents work outside any Repo.

**Party**:
The Heroes of one Workspace, within their Guild. A lone Hero is a Party of one.
_Avoid_: Team, army, group

**Minion**:
The in-game character standing for a Subagent, following its Hero.
_Avoid_: Helper, follower

**Horde**:
The skeletons that attack a Hero in its Death Scene.
_Avoid_: Zombies, mob

### Places

**Town**:
The main map, where Heroes who aren't working spend their time.

**Camp**:
A Guild's home spot in the Town, marked by its banner.

**Graveyard**:
The place in the Town where Graves stand.

**Dungeon**:
The seeded underground place belonging to a Guild, where its Heroes go while working.

**Depth Tier**:
One of the Dungeon's four themed levels: Prison, Caves, Catacombs and Hell. A Hero's Level decides its Depth Tier.
_Avoid_: Floor, stage

**Warp Portal**:
The blue portal a Hero uses to appear in or leave a place.
_Avoid_: Teleporter, gate

### Progress

**Quest**:
What a Hero is currently working on, taken from its Agent's terminal title.
_Avoid_: Task, job

**Experience**:
All the tokens a Hero's Agent and its Subagents have used, cache reads included, accumulated over the Hero's whole life. Each billed token counts once, so a fork starts with only what it spends itself.
_Avoid_: XP in prose, points, score

**Level**:
A Hero's rank from 1 to 99, derived from its Experience.

**Aura**:
The lasting glow only a Level 99 Hero has.

### Life and death

**Death**:
The end of a Hero, when its Agent exits, is killed or is cleared.

**Death Scene**:
How a Death plays out on screen. Every Death gets the same one, currently the Horde attacking until the Hero falls.

**Grave**:
The marker a dead Hero leaves in the Graveyard for a day.

**Resurrection**:
A dead Hero coming back, with its Level intact, when its Agent's session is resumed. It rises from its Grave if the Grave still stands, otherwise it arrives through a Warp Portal.

### Attention

**Roster**:
The always-visible list of every Guild, Party and Hero and their state.
_Avoid_: Sidebar, list

**Attention Queue**:
The ordered set of Heroes who need the person right now, which the jump key cycles through.

**Raven**:
The sign that an Agent is waiting on the person: a prompt in its terminal (a permission, a question or a plan to approve), or an open question or action item it sent to the Plannotator Inbox.
_Avoid_: Notification, alert

**Notice Board**:
The board by the Town gate holding open Inbox questions and action items whose Agent has no living Hero.
_Avoid_: Town board, bulletin

**Loot Chest**:
The sign that a Hero finished its work. It opens once the person has looked at the Agent in Herdr.

**Narration**:
The fantasy line a Hero says about what its Agent is doing, shown in a speech bubble.
_Avoid_: Log, status text

**Chronicle**:
The running record of notable events, like Level ups, Deaths and Ravens, shown in a chat box.
_Avoid_: Log, feed, history
