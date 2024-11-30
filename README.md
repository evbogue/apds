# Bog5 Protocol

Bogbook has been thru a few iterations. For the fans, thanks for sticking with me. For the people who want standards, I solicit your feedback. And now, the protocol...

We send around sha256 hashes since we're using content-addressable storage for everything. First we request the hash that finds us a **protocol message**:

```
<ed25519 pubkey><ed25519 sig>
```

This opens to:

```
<unix timestamp><sha256 hash>
```

The timestamp is required since this is a social network. The sha256 hashlinks either locally or over the gossip network to a **content message**, which is Yaml file that contains everything else we need to make a post render while not duplicating too much of what we might have already such as avatar photos.

Everything in the **protocol message** is we need to sort and authenticate a feed. Everything in the **content message** is what we need to render a message.

```
Text content
```


A full post might look like this: 

```
---
previous: sha256 hash previous protocol message
name: Ev
image: sha256 of image blob
edit: sha256 hash of edited protocol message
---
Content
```

This means you could in theory edit your name and/or image on a post! But we also want a record of what your name and image was on the original post, since it is a security issue with some actors on decentralized social networks if you allow publishers to change their name over their entire feed. Or, for example, in a hack it would be harder to rewrite history.

---
MIT
