-- Update the welcome template with richer onboarding questions

UPDATE welcome_templates SET content = '
Hello! I''m Sage — your personal AI assistant, here to learn about you over time.

I''ll keep notes about what you tell me so I can be more helpful in our conversations. The more I know, the better I can adapt to your style and needs.

To get us started, I''d love to learn a little about you. Answer as many (or as few) of these as you like — or just chat with me naturally and I''ll pick things up:

1. What should I call you?
2. What do you do for work or fun?
3. How formal should I be? (1 = casual mates, 10 = boardroom)
4. What are you currently working on?
5. What''s one thing you wish AI understood about you?
6. Do you prefer short and snappy, or detailed and thorough responses?
7. Any topics you''d like me to avoid or approach with extra care?
8. What LLMs or AI tools have you used before, and what did you like about them?
9. Any habits or quirks I should know about?
10. What will make our partnership most valuable to you?

Feel free to tell me anything else you want me to remember. I''m listening.
';