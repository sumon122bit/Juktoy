#include <iostream>
#include <string>
#include <sstream>
#include <iomanip>
#include <cstdint>

// Salt + Password মিশিয়ে ডাবল FNV-1a ভিত্তিক হ্যাশ তৈরি
std::string hashPassword(const std::string& password, const std::string& salt) {
    std::string data = salt + "::" + password + "::" + salt;

    uint64_t h1 = 1469598103934665603ULL;
    uint64_t h2 = 1099511628211ULL;

    for (size_t i = 0; i < data.size(); ++i) {
        unsigned char c = (unsigned char)data[i];
        h1 ^= c;
        h1 *= 1099511628211ULL;
        h2 = h2 * 31 + c + (h1 >> 17);
        h2 ^= (h2 << 7);
    }

    std::stringstream ss;
    ss << std::hex << std::setfill('0')
       << std::setw(16) << h1
       << std::setw(16) << h2;
    return ss.str();
}

// Read entire stdin as string (trim trailing newline)
std::string readStdin() {
    std::stringstream ss;
    ss << std::cin.rdbuf();
    std::string s = ss.str();
    if (!s.empty() && s.back() == '\n') s.pop_back();
    if (!s.empty() && s.back() == '\r') s.pop_back();
    return s;
}

int main() {
    // Format: line 1 = password, line 2 = salt
    // Reads from stdin so password NEVER appears in process list (ps aux)
    std::string password, salt;
    if (!std::getline(std::cin, password)) {
        std::cerr << "Usage: echo -e '<password>\\n<salt>' | security" << std::endl;
        return 1;
    }
    if (!std::getline(std::cin, salt)) {
        std::cerr << "Missing salt line" << std::endl;
        return 1;
    }

    std::cout << hashPassword(password, salt) << std::endl;
    return 0;
}
