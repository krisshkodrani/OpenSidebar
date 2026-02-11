# Memory System (Second Brain)

OpenSidebar's local memory keeps your information private while giving the AI persistent knowledge across sessions.

## How It Works

The memory system uses hybrid search combining semantic understanding with keyword matching, all running locally in your browser.

### Hybrid Search

- **Semantic Search** - Understands meaning and concepts (using vector embeddings)
- **Keyword Search** - Finds exact matches and specific terms
- **Smart Fusion** - Combines both approaches for best results

### Privacy First

- **Local Storage** - Everything stays in your browser (IndexedDB)
- **No Cloud Upload** - Your data never leaves your device
- **Encrypted at Rest** - Chrome's built-in encryption protects stored data

### Supported Content

- **Web pages** - Content from sites you visit
- **PDFs** - Extract and remember document content
- **User preferences** - Your personal settings and choices
- **Research findings** - Information discovered during tasks

## Using Memory

### Saving Information

Tell the AI to remember things naturally:

```
"Remember that I prefer window seats on flights"
"Save that my favorite programming language is TypeScript"
"Store this recipe for later reference"
```

The AI automatically extracts key information and stores it with appropriate categories.

### Finding Information

Ask about things you've saved:

```
"What are my flight preferences?"
"What programming languages do I know?"
"Find that recipe I saved last week"
"Show me all information about project management"
```

### Context-Aware Suggestions

The AI automatically suggests relevant memories based on your current task:

- When booking flights → recalls your seat preferences
- When coding → remembers your favorite languages
- When researching → shows related saved information

## Technical Details

### Storage Structure

Each memory entry includes:

- **Content** - The main text/information
- **Category** - Type of information (preferences, research, etc.)
- **Source** - Where it came from (URL, PDF, user input)
- **Embedding** - Vector representation for semantic search
- **Timestamp** - When it was saved

### Search Process

1. **Query Analysis** - Your question is converted to a vector embedding
2. **Parallel Search** - Both semantic and keyword searches run simultaneously
3. **Rank Fusion** - Results are combined using Reciprocal Rank Fusion (RRF)
4. **Context Injection** - Top results are provided to the AI as context

### Performance

- **Initial Setup** - First use downloads embedding model (~23MB)
- **Search Speed** - Local search takes < 100ms
- **Storage Capacity** - Limited only by browser storage quota
- **Offline Access** - Works without internet connection

## Memory Categories

Common categories include:

- **Preferences** - Your personal choices and settings
- **Research** - Information gathered during tasks
- **Contacts** - People and their details
- **Projects** - Work-related information
- **Recipes** - Cooking instructions and ingredients
- **Travel** - Trip details and preferences

## Example Workflows

### Travel Planning

```
You: "Remember that I'm allergic to peanuts and prefer aisle seats"
AI: "I've saved your dietary restriction and seat preference"

Later...
You: "Find flights from NYC to LA"
AI: "I found several options. I'll look for aisle seats and note your peanut allergy when booking."
```

### Research Assistant

```
You: "Save this article about quantum computing for my research"
AI: "Saved to your research collection"

Later...
You: "What do I know about quantum computing?"
AI: "From your saved research, quantum computing uses quantum bits..."
```

### Personal Assistant

```
You: "Remember my mom's birthday is March 15th"
AI: "Saved your mother's birthday"

Later...
You: "What important dates are coming up this month?"
AI: "Your mother's birthday is on March 15th, which is next week."
```

## Memory Commands

### Direct Commands

- **"Save this"** - Stores current page content
- **"Remember that [fact]"** - Saves specific information
- **"Search memory for [query]"** - Finds saved information
- **"Show me all [category] memories"** - Lists by category

### Automatic Saving

The AI automatically saves:

- **Important discoveries** during research tasks
- **User preferences** mentioned in conversation
- **Task results** when you ask it to remember

## Managing Memory

### Viewing Memories

Ask the AI to show your memories:

```
"Show me all my saved memories"
"What do I have stored about travel?"
"List my research memories from this week"
```

### Updating Memories

```
"Update my seat preference to window instead of aisle"
"Change my programming language preference to Python"
```

### Deleting Memories

```
"Delete my old memories about project X"
"Remove the recipe I saved yesterday"
```

## Security & Privacy

### Data Protection

- **Browser Encryption** - Chrome encrypts IndexedDB at rest
- **No Third Parties** - Data never sent to external servers
- **Sandboxed** - Memory runs in isolated browser context

### Control

- **Full Access** - You control all stored data
- **Easy Export** - Can export all memories if needed
- **Selective Deletion** - Remove specific memories or categories

## See Also

- [Browser Automation](./browser-automation.md) - How AI interacts with pages
- [Workspace Management](./workspace-management.md) - Organize related activities
- [Technical Architecture](../architecture/memory-system.md) - Implementation details
