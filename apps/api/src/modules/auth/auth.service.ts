import { Injectable } from "@nestjs/common";

@Injectable()
export class AuthService {
  getCurrentUser() {
    return { message: "Auth endpoint ready" };
  }
}
