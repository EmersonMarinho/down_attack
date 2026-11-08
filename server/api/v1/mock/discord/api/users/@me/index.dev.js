import { faker } from "@faker-js/faker";

export default controller.handle({
  async get(event) {
    const accessToken = getHeader(event, "authorization");

    if (accessToken?.startsWith("Bearer mocked_user_")) {
      const parts = accessToken.split("_");
      const discordId = parts[2];
      const customUsername = parts.slice(3).join("_");

      return UserObject(discordId, customUsername);
    }

    return UserObject();

    // Example Discord Return

    //     {
    //         "id": "268473310986240001",
    //         "username": "discord",
    //         "avatar": "f749bb0cbeeb26ef21eca719337d20f1",
    //         "discriminator": "0",
    //         "global_name": "Discord",
    //         "public_flags": 131072
    //     }

    function generateMockUsername() {
      const base =
        faker.internet
          .username()
          .replace(/[^a-zA-Z0-9]/g, "")
          .slice(0, 20) || "discorduser";
      const suffix = faker.string.alphanumeric(6).toLowerCase();

      return `${base}.${suffix}`;
    }

    async function UserObject(discord_id, username) {
      const fakeUsername = username ? username : generateMockUsername();
      const fakeUserId = discord_id ? discord_id : "268473310986240001";
      const fakeAvatar = "f749bb0cbeeb26ef21eca719337d20f1";

      const fakeUserObject = {
        id: fakeUserId,
        username: fakeUsername,
        avatar: fakeAvatar,
        discriminator: "0",
        global_name: "Discord",
        public_flags: 131072,
      };

      return fakeUserObject;
    }
  },
});
