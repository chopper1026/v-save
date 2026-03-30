import Foundation

private struct BridgeCompletionEnvelope: Decodable {
    let success: Bool?
    let message: String?
    let data: CompleteBridgeAuthResponse?
}

final class CompanionServerSyncClient: @unchecked Sendable {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func completeBridgeAuth(
        payload: CompleteBridgeAuthRequest,
        backendOrigin: String
    ) async throws -> CompleteBridgeAuthResponse {
        let normalizedOrigin = backendOrigin.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
        guard !normalizedOrigin.isEmpty else {
            throw NSError(
                domain: CompanionConfig.appName,
                code: 9,
                userInfo: [NSLocalizedDescriptionKey: "backendOrigin is required"]
            )
        }

        let endpoint = URL(string: "/api/douyin/auth/bridge/complete", relativeTo: URL(string: normalizedOrigin))!
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(payload)

        let (data, response) = try await session.data(for: request)
        let httpResponse = response as? HTTPURLResponse
        let envelope = (try? JSONDecoder().decode(BridgeCompletionEnvelope.self, from: data))
            ?? BridgeCompletionEnvelope(success: false, message: nil, data: nil)

        let statusCode = httpResponse?.statusCode ?? -1
        guard (200..<300).contains(statusCode), envelope.success == true, let result = envelope.data else {
            let message = envelope.message ?? "桥接登录回传失败: HTTP \(statusCode)"
            throw NSError(
                domain: CompanionConfig.appName,
                code: 10,
                userInfo: [NSLocalizedDescriptionKey: message]
            )
        }

        return result
    }
}
